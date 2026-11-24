import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {groupVesselTrailRecords,mergeVesselTrailWindow,selectedVesselTrail,vesselWindowStart,VESSEL_HISTORY_MAX_BYTES,VESSEL_HISTORY_SAMPLE_MS} from "../lib/vessel-trails.mjs";

const now=Date.now(),mmsi="232001234",name="Rescue boat";
const record=(at=now,extra={})=>({kind:"vessel",identifier:mmsi,name,observedAt:at,lat:55.8,lon:-4.2,...extra});

test("history rejects invalid fixes and retains real timestamps, with at most one fix per 30-second slot",()=>{
 const start=vesselWindowStart(now),at=start+1000;
 const invalid=[record(now,{kind:"aircraft"}),record(now,{identifier:"bad"}),record(now,{lat:91}),record(now-900001),record(now+60001)];
 assert.equal(groupVesselTrailRecords(invalid,now).size,0);
 const first=mergeVesselTrailWindow({},[record(at),record(at+500,{lat:55.801})],start);
 assert.deepEqual(first[mmsi].points,[[at+500,55.801,-4.2]]);
 assert.deepEqual(mergeVesselTrailWindow(first,[record(at)],start),first);
 const next=mergeVesselTrailWindow(first,[record(at+30000,{lat:55.802})],start);
 assert.equal(next[mmsi].points.length,2);
 assert.equal(next[mmsi].points[1][0],at+30000);
 assert.deepEqual(mergeVesselTrailWindow(next,[record(at+30000,{name:"Reassigned identity"})],start)[mmsi].points,[[at+30000,55.8,-4.2]]);
});

test("selected histories filter by identity and time and leave missing reception and implausible jumps open",()=>{
 const chunks=[{name,points:[[now-7*3600000,55,-4],[now-200000,55,-4],[now-170000,55.001,-4],[now-160000,60,0],[now-1000,60.001,0]]},{name:"Other vessel",points:[[now-100,55,-4]]}];
 const selected=selectedVesselTrail(chunks,name,6,now);
 assert.equal(selected.points.length,4);assert.equal(selected.segments.length,2);assert.equal(selected.gaps,true);
 assert.equal(selected.hours,6);assert.ok(selected.points.every(p=>p.at>=now-6*3600000));
 assert.equal(selectedVesselTrail(chunks,name,24,now).segments.length,3);
 assert.equal(selectedVesselTrail([],name,6,now).points.length,0);
});

test("a full 600-vessel time block stays below the per-row byte bound without individual position writes",()=>{
 const start=vesselWindowStart(now);let state={};
 for(let slot=0;slot<10;slot++){
  state=mergeVesselTrailWindow(state,Array.from({length:600},(_,i)=>record(start+slot*VESSEL_HISTORY_SAMPLE_MS,{identifier:String(232000000+i),name:`Rescue vessel ${i}`})),start);
 }
 assert.equal(Object.keys(state).length,600);assert.equal(state["232000000"].points.length,10);
 assert.ok(new TextEncoder().encode(JSON.stringify(state)).length<VESSEL_HISTORY_MAX_BYTES);
});

test("real D1 history capture and public route enforce windows, retention, identity checks and the shared free cap",async()=>{
 const fleet=JSON.parse(await readFile(new URL("../data/vessels.json",import.meta.url),"utf8")).records;
 const vessel=fleet.find(v=>/^\d{9}$/.test(v.mmsi)&&!v.identity_conflict),other=fleet.find(v=>/^\d{9}$/.test(v.mmsi)&&!v.identity_conflict&&v.mmsi!==vessel.mmsi);
 const compiled=await build({stdin:{contents:`import {captureVesselTrails} from './lib/vessel-trail-store.ts';import {GET} from './app/api/tracks/vessels/[mmsi]/route.ts';import {POST as ingest} from './app/api/ingest/vessels/route.ts';export default {async fetch(r){if(new URL(r.url).pathname==='/ingest')return ingest(r);if(new URL(r.url).pathname==='/capture'){const b=await r.json();await captureVesselTrails(b.records,b.now);return Response.json({ok:true});}return GET(r,{params:Promise.resolve({mmsi:new URL(r.url).pathname.slice(1)})});}};`,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],external:["cloudflare:workers"],write:false});
 let providerRequests=0;
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",d1Databases:{DB:"vessel-history-test"},bindings:{VESSEL_INGEST_TOKEN:"synthetic-vessel-history-ingest-token-long-enough"},outboundService:()=>{providerRequests++;throw Error("History must not query AIS or an aircraft provider");}});
 try{
  const db=await mf.getD1Database("DB");
  await db.prepare("CREATE TABLE feed_state(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,fetched_at INTEGER NOT NULL DEFAULT 0,next_poll_at INTEGER NOT NULL DEFAULT 0,window_start INTEGER NOT NULL DEFAULT 0,requests INTEGER NOT NULL DEFAULT 0,blocked_until INTEGER NOT NULL DEFAULT 0,last_error TEXT)").run();
  await db.prepare("CREATE TABLE vessel_trail_windows(window_start INTEGER PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL)").run();
  const upload={positions:[{mmsi:vessel.mmsi,lat:55.8,lon:-4.2,observedAt:now,speed:0}]};
  assert.equal((await mf.dispatchFetch("https://site.test/ingest",{method:"POST",body:JSON.stringify(upload)})).status,401);
  assert.equal((await mf.dispatchFetch("https://site.test/ingest",{method:"POST",headers:{Authorization:"Bearer synthetic-vessel-history-ingest-token-long-enough"},body:JSON.stringify(upload)})).status,200);
  const received=await (await mf.dispatchFetch(`https://site.test/${vessel.mmsi}`)).json();assert.equal(received.points.length,1);assert.equal(received.points[0].at,now);
  await db.prepare("DELETE FROM vessel_trail_windows").run();await db.prepare("DELETE FROM feed_state").run();
  const capture=async(at,records)=>{const r=await mf.dispatchFetch("https://site.test/capture",{method:"POST",body:JSON.stringify({now:at,records})});assert.equal(r.status,200);};
  const known=(at,extra={})=>record(at,{identifier:vessel.mmsi,name:vessel.vessel_name,...extra});
  for(const offset of [7*3600000,5*3600000,59*60000,60000]){const at=now-offset;await capture(at,[known(at),known(at,{identifier:other.mmsi,name:other.vessel_name,lat:56})]);}
  const get=async(hours=6)=>{const r=await mf.dispatchFetch(`https://site.test/${vessel.mmsi}?hours=${hours}`);assert.equal(r.status,200);return r.json();};
  let history=await get();assert.equal(history.points.length,3);assert.equal(history.hours,6);assert.equal(history.retentionHours,48);assert.equal(history.sampleSeconds,30);assert.equal(history.partialWindow,false);assert.ok(!JSON.stringify(history).includes(other.vessel_name));
  assert.equal((await get(1)).points.length,2);assert.equal((await get(24)).points.length,4);
  await capture(now,[known(now-60000)]);assert.equal((await get()).points.length,3);
  const expired=vesselWindowStart(now-49*3600000);await db.prepare("INSERT INTO vessel_trail_windows VALUES(?, '{}', ?)").bind(expired,expired).run();
  await capture(now+31000,[known(now+30000)]);assert.equal(await db.prepare("SELECT window_start FROM vessel_trail_windows WHERE window_start=?").bind(expired).first(),null);
  await db.prepare("UPDATE feed_state SET requests=2880,window_start=? WHERE id='vessel-trails'").bind(now).run();
  const before=await db.prepare("SELECT payload FROM vessel_trail_windows WHERE window_start=?").bind(vesselWindowStart(now+30000)).first();
  await capture(now+62000,[known(now+60000)]);assert.deepEqual(await db.prepare("SELECT payload FROM vessel_trail_windows WHERE window_start=?").bind(vesselWindowStart(now+30000)).first(),before);
  assert.equal((await get()).captureBudgetPaused,true);
  assert.equal((await mf.dispatchFetch(`https://site.test/${vessel.mmsi}?hours=999`)).status,400);
  assert.equal((await mf.dispatchFetch("https://site.test/not-a-mmsi")).status,400);
  assert.equal((await mf.dispatchFetch("https://site.test/999999999")).status,404);
  assert.equal(providerRequests,0);
 }finally{await mf.dispose();}
});
