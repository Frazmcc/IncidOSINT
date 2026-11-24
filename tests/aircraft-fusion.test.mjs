import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {build} from "esbuild";
import {Miniflare} from "./helpers/miniflare.mjs";
import {combineAircraftSnapshots} from "../lib/aircraft-fusion.mjs";
import {advanceTrailBatch,budgetedTrailUpdates} from "../lib/flight-trails.mjs";
import {vesselRouteView,vesselRouteDirections} from "../lib/vessel-route-view.mjs";

const now=Date.now(),fleet=[{icao_hex:"407083",registration:"G-POLS"}];
const a={id:"air-407083",kind:"aircraft",identifier:"407083",name:"G-POLS",lat:55.8,lon:-4.2,observedAt:now-60000,onGround:false,feedProvider:"adsb.lol"};

test("both aircraft sources merge by actual observation time without duplicates, foreign rejection or impossible jumps",()=>{
 const newer={...a,lat:55.801,observedAt:now-30000,feedProvider:"adsb.fi"};
 for(const sources of [[{records:[a]},{records:[newer]}],[{records:[newer]},{records:[a]}]])assert.deepEqual(combineAircraftSnapshots(sources,now,fleet).records,[newer]);
 assert.equal(combineAircraftSnapshots([{records:[a,a]},{records:[a],rejected:[{hex:"407083"}]}],now,fleet).records.length,1);
 assert.equal(combineAircraftSnapshots([{records:[a]},{records:[{...newer,lat:61,lon:2,observedAt:a.observedAt+1000}]}],now,fleet).records[0].lat,a.lat);
 assert.equal(combineAircraftSnapshots([{records:[{...newer,name:"Wrong registration"}]}],now,fleet).records.length,0);
 assert.equal(combineAircraftSnapshots([{records:[{...a,onGround:true}]},{unpositioned:[{identifier:a.identifier,onGround:false,lastSeenAt:now}]}],now,fleet).records.length,0);
});

test("aircraft history spaces routine samples within the free allowance while retaining take-off and landing transitions",()=>{
 const existing=new Map(advanceTrailBatch([a],new Map(),now).map(v=>[v.record.identifier,v.state]));
 const constrained={window_start:now-1000,samples:7990};
 const move={...a,observedAt:now,lat:55.801};
 assert.equal(budgetedTrailUpdates(advanceTrailBatch([move],existing,now),existing,[move],constrained,now).length,0);
 const landed={...move,onGround:true};
 assert.equal(budgetedTrailUpdates(advanceTrailBatch([landed],existing,now),existing,[landed],constrained,now).length,1);
 const ground={...a,observedAt:now-1000,onGround:true};
 const start=budgetedTrailUpdates(advanceTrailBatch([ground,move],new Map(),now),new Map(),[ground,move],constrained,now);
 assert.equal(start.length,1);assert.equal(start[0].state.active.departureObserved,true);
 assert.equal(budgetedTrailUpdates(advanceTrailBatch([ground],new Map(),now),new Map(),[ground],constrained,now).length,0);
});

test("vessel route presentation distinguishes a route from single-position, same-location and reception-gap histories",()=>{
 const p={lat:55.8,lon:-4.2,at:now-30000},q={lat:55.81,lon:-4.2,at:now};
 assert.equal(vesselRouteView({points:[],segments:[]}).state,"empty");
 assert.equal(vesselRouteView({points:[p],segments:[[p]]}).state,"single");
 assert.equal(vesselRouteView({points:[p,{...p,at:now}],segments:[[p,{...p,at:now}]]}).state,"location");
 const route=vesselRouteView({points:[p,q],segments:[[p,q]]});assert.equal(route.state,"route");assert.deepEqual(route.first,p);assert.deepEqual(route.last,q);
 assert.equal(vesselRouteView({points:[p,q],segments:[[p],[q]]}).state,"gaps");
 const arrows=vesselRouteDirections(route.segments);assert.equal(arrows.length,1);assert.equal(arrows[0].bearing,0);assert.equal(arrows[0].at,q.at);
});

test("authenticated check-ins share one adsb.fi allowance, merge successful feeds and back off a refusal without exposing private keys",async()=>{
 const records=JSON.parse(await readFile(new URL("../data/aircraft.json",import.meta.url),"utf8")),aircraft=records[0];
 const compiled=await build({stdin:{contents:`import {POST} from './app/api/collector/aircraft/route.ts';import {recordAircraftPayload,aircraftSnapshot} from './lib/live-store.ts';import {GET} from './app/api/live/route.ts';export default{async fetch(r){const p=new URL(r.url).pathname;if(p==='/collector')return POST(r);if(p==='/seed'){await recordAircraftPayload(await r.json(),'adsblol');return Response.json({ok:true});}if(p==='/summary')return Response.json(await aircraftSnapshot());return GET(r);}};`,resolveDir:process.cwd()},bundle:true,platform:"neutral",mainFields:["module","main"],format:"esm",external:["cloudflare:workers"],write:false});
 let calls=0,mode=200;
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",d1Databases:{DB:"fusion-test"},bindings:{VESSEL_INGEST_TOKEN:"synthetic-control-token",ADSB_LOL_FREE_KEY:"synthetic-provider-key"},outboundService:request=>{
  calls++;assert.equal(new URL(request.url).origin,"https://opendata.adsb.fi");
  for(const key of ["authorization","x-api-key","oai-sites-authorization"])assert.equal(request.headers.has(key),false);
  if(mode!==200)return new Response("Refused",{status:mode});
  return Response.json({now:Date.now(),ac:[{hex:aircraft.icao_hex,r:aircraft.registration,lat:55.801,lon:-4.2,seen_pos:0,alt_baro:1000,type:"adsb_icao"}]});
 }});
 try{
  const db=await mf.getD1Database("DB");
  for(const filename of ["0000_light_random.sql","0001_burly_ink.sql","0002_amazing_warhawk.sql"]){const sql=await readFile(new URL(`../drizzle/${filename}`,import.meta.url),"utf8");for(const statement of sql.replace(/--> statement-breakpoint/g,"").split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}
  await mf.dispatchFetch("https://site.test/seed",{method:"POST",body:JSON.stringify({now:Date.now(),ac:[{hex:aircraft.icao_hex,r:aircraft.registration,lat:55.8,lon:-4.2,seen_pos:60,alt_baro:1000}]})});
  const lease=()=>mf.dispatchFetch("https://site.test/collector",{method:"POST",headers:{Authorization:"Bearer synthetic-control-token"},body:JSON.stringify({action:"lease"})});
  assert.equal((await mf.dispatchFetch("https://site.test/collector",{method:"POST",body:'{"action":"lease"}'})).status,401);assert.equal(calls,0);
  await Promise.all(Array.from({length:10},lease));assert.equal(calls,1);
  const summary=await (await mf.dispatchFetch("https://site.test/summary")).json();assert.equal(summary.records.length,1);assert.equal(summary.records[0].feedProvider,"adsb.fi");assert.equal(summary.provider,"adsb.lol + adsb.fi");assert.equal(summary.intervalSeconds,30);
  for(let i=0;i<10;i++){const response=await mf.dispatchFetch("https://site.test/live");assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes("synthetic-provider-key"));assert.match(response.headers.get("Cache-Control"),/s-maxage=5/);}
  assert.equal(calls,1);
  await db.prepare("UPDATE feed_state SET next_poll_at=0 WHERE id='aircraft-adsbfi'").run();mode=403;await lease();assert.equal(calls,2);
  const state=await db.prepare("SELECT blocked_until,requests FROM feed_state WHERE id='aircraft-adsbfi'").first();assert.equal(state.requests,2);assert.ok(state.blocked_until>=Date.now()+86390000);
  for(let i=0;i<5;i++)await lease();assert.equal(calls,2);
  const paused=await (await mf.dispatchFetch("https://site.test/summary")).json();assert.equal(paused.sources.find(s=>s.name==='adsb.fi').status,"paused");assert.equal(paused.records[0].observedAt,summary.records[0].observedAt);
 }finally{await mf.dispose();}
});
