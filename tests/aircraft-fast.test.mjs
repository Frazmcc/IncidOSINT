import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {build} from "esbuild";
import {Miniflare} from "./helpers/miniflare.mjs";
import {createFastCollector} from "../collector/render-aircraft.mjs";
import {fastProviderUrl,compactAircraftPayload,FAST_POLL_MS,FAST_BATCH_REQUESTS,FAST_CONNECT_TIMEOUT_MS,FAST_CLIENT_TIMEOUT_MS} from "../lib/aircraft-fast-policy.mjs";
import {blendAircraftLive} from "../lib/aircraft-live-view.mjs";
import {normalizeAircraft} from "../lib/tracking-core.mjs";
import {advanceTrail,compactFlightPoints} from "../lib/flight-trails.mjs";
const fleet=JSON.parse(await readFile(new URL("../data/aircraft.json",import.meta.url),"utf8")),plane=fleet[0],token="synthetic-fast-collector-secret-1234567890";
const ac={hex:plane.icao_hex,r:plane.registration,lat:55.8,lon:-4.2,seen_pos:0,alt_baro:1000,seen:0,squawk:"0023"};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test("the fast transport uses one bounded lease for 14 spaced polls; viewers cannot multiply requests or leak secrets",async()=>{
 let now=Date.now(),report,coordinatorCalls=0;const timers=[],starts=[];
 const collector=createFastCollector({siteUrl:"https://site.test",token,fleet,clock:()=>now,schedule:(callback,delay)=>{timers.push({callback,delay});return timers.length;},fetcher:async(input,init)=>{
  const url=new URL(input);
  if(url.hostname==="site.test"){
   assert.equal(init.headers.Authorization,`Bearer ${token}`);const body=JSON.parse(init.body);
   if(body.action==="lease"){coordinatorCalls++;return Response.json({acquired:true,pollId:"one-permit",url:`https://opendata.adsb.fi/api/v2/icao/${plane.icao_hex}`,expiresAt:now+30000,intervalMs:FAST_POLL_MS,maximumRequests:FAST_BATCH_REQUESTS});}
   report=body;return Response.json({accepted:true});
  }
  assert.equal(url.origin,"https://opendata.adsb.fi");assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers["x-api-key"],undefined);assert.match(init.headers["User-Agent"],/IncidOSINT/);starts.push(now);
  return Response.json({now,ac:[{...ac,lat:ac.lat+starts.length/10000}]});
 }});
 collector.demand();for(let i=0;i<1000;i++)collector.demand();
 for(let i=0;i<100&&!report;i++){
  await flush();if(timers.length&&!report){const t=timers.shift();now+=t.delay;t.callback();}
 }
 collector.stop();assert.equal(coordinatorCalls,1);assert.equal(starts.length,14);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=2100);
 assert.equal(report.requestCount,14);assert.equal(report.statusCode,200);assert.equal(collector.view().records.length,1);assert.ok(!JSON.stringify(collector.view()).includes(token));
 assert.equal(collector.authorized(`Bearer ${token}`),true);assert.equal(collector.authorized("Bearer wrong"),false);
});
test("upstream 429 stops the current batch and is reported once with Retry-After",async()=>{
 let report,calls=0;const timers=[];const collector=createFastCollector({siteUrl:"https://site.test",token,fleet,schedule:(cb,delay)=>{timers.push({cb,delay});return timers.length;},fetcher:async(input,init)=>{
  if(new URL(input).hostname==="site.test"){const body=JSON.parse(init.body);if(body.action==="lease")return Response.json({acquired:true,pollId:"limited",url:`https://opendata.adsb.fi/api/v2/icao/${plane.icao_hex}`,expiresAt:Date.now()+30000,intervalMs:2100,maximumRequests:14});report=body;return Response.json({accepted:false,nextPollAt:Date.now()+3600000});}
  calls++;return new Response("limited",{status:429,headers:{"Retry-After":"3600"}});
 }});collector.demand();for(let i=0;i<30&&!report;i++)await flush();collector.stop();assert.equal(calls,1);assert.equal(report.retryAfter,"3600");assert.equal(collector.view().status,"paused");assert.ok(timers[0].delay>3500000);
});
test("the collector only accepts documented provider URLs and bounded watchlisted fields",()=>{
 assert.ok(fastProviderUrl("https://opendata.adsb.fi/api/v2/icao/407083,406de7"));
 for(const url of ["https://attacker.test/api/v2/icao/407083","https://opendata.adsb.fi/api/v2/snapshot","https://opendata.adsb.fi/api/v2/icao/407083?key=anything"])assert.throws(()=>fastProviderUrl(url));
 const payload=compactAircraftPayload({now:Date.now(),ac:[{...ac,apiKey:"private"},{hex:"badbad"}]},new Set([plane.icao_hex]));assert.equal(payload.ac.length,1);assert.equal(payload.ac[0].apiKey,undefined);
});
test("archive refreshes cannot move a fast aircraft fix backwards",()=>{
 const now=Date.now(),old={id:`air-${plane.icao_hex}`,identifier:plane.icao_hex,name:plane.registration,kind:"aircraft",lat:55.8,lon:-4.2,observedAt:now-60000,onGround:false};
 const fast={enabled:true,records:[{...old,lat:55.801,observedAt:now}],status:"receiving",fetchedAt:now};
 const merged=blendAircraftLive({records:[old],sources:[],provider:"adsb.lol",fetchedAt:now-30000},fast,now);assert.equal(merged.records[0].lat,55.801);assert.equal(merged.intervalSeconds,2.1);assert.equal(merged.provider,"adsb.lol + adsb.fi");
});
test("a long high-resolution flight retains its real departure, latest positions and landing within a bounded route",()=>{
 const start=Date.now()-4_000_000,base={id:`air-${plane.icao_hex}`,identifier:plane.icao_hex,name:plane.registration,kind:"aircraft",lat:55.8,lon:-4.2};
 let state=advanceTrail(null,{...base,observedAt:start,onGround:true},start);
 for(let i=1;i<=1500;i++)state=advanceTrail(state,{...base,observedAt:start+i*2100,onGround:false,lat:55.8+i/100000},start+i*2100);
 assert.equal(state.active.departureObserved,true);assert.equal(state.active.points[0].at,start);assert.ok(state.active.points.length<=1000);assert.equal(state.active.compacted,true);
 state=advanceTrail(state,{...base,observedAt:start+1501*2100,onGround:true},start+1501*2100);assert.equal(state.completed.at(-1).status,"returned");assert.equal(state.completed.at(-1).points[0].at,start);
 const pathological=Array.from({length:1500},(_,i)=>({lat:55,lon:-4,at:start+i*700000,ground:false}));assert.ok(compactFlightPoints(pathological).length<=1000);
});
test("the public fast endpoint shares a cache, validates aircraft and strips all private transport fields",async()=>{
 const compiled=await build({stdin:{contents:`import {GET} from './app/api/live/aircraft/route.ts';export default{fetch:GET};`,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],external:["cloudflare:workers"],write:false});
 let calls=0;const normalized=normalizeAircraft({now:Date.now(),ac:[ac]},fleet);
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",bindings:{ADSB_FI_COLLECTOR_TOKEN:token,ADSB_FI_FAST_URL:"https://collector-test.onrender.com"},outboundService:request=>{
  calls++;assert.equal(request.url,"https://collector-test.onrender.com/snapshot");assert.equal(request.headers.get("Authorization"),`Bearer ${token}`);
  return Response.json({...normalized,records:[{...normalized.records[0],apiKey:token}],apiKey:token,fetchedAt:Date.now(),status:"receiving"});
 }});
 try{
  const responses=await Promise.all(Array.from({length:30},()=>mf.dispatchFetch("https://site.test/api/live/aircraft")));assert.equal(calls,1);
  for(const response of responses){assert.equal(response.status,200);assert.match(response.headers.get("Cache-Control"),/s-maxage=2/);const text=await response.text();assert.ok(!text.includes(token));assert.ok(!text.includes("apiKey"));const body=JSON.parse(text);assert.equal(body.enabled,true);assert.equal(body.records.length,1);assert.equal(body.records[0].name,plane.registration);}
 }finally{await mf.dispose();}
});
test("real D1 permits are shared across collectors and survive failed reports, restarts and replay",async()=>{
 const compiled=await build({stdin:{contents:`import {POST} from './app/api/collector/adsbfi/route.ts';export default{fetch:POST};`,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],external:["cloudflare:workers"],write:false});
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",d1Databases:{DB:"fast-permit-test"},bindings:{ADSB_FI_COLLECTOR_TOKEN:token}});
 try{
  const db=await mf.getD1Database("DB");for(const filename of ["0000_light_random.sql","0001_burly_ink.sql","0002_amazing_warhawk.sql"]){const sql=await readFile(new URL(`../drizzle/${filename}`,import.meta.url),"utf8");for(const statement of sql.replace(/--> statement-breakpoint/g,"").split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}
  const call=body=>mf.dispatchFetch("https://site.test/collector",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  assert.equal((await mf.dispatchFetch("https://site.test/collector",{method:"POST",body:'{"action":"lease"}'})).status,401);
  const replies=await Promise.all(Array.from({length:30},()=>call({action:"lease"}).then(r=>r.json()))),lease=replies.find(r=>r.acquired);assert.equal(replies.filter(r=>r.acquired).length,1);assert.equal(lease.maximumRequests,14);
  const report={action:"report",pollId:lease.pollId,requestCount:14,statusCode:200,payload:{now:Date.now(),ac:[ac]}};
  assert.equal((await (await call(report)).json()).accepted,true);assert.equal((await call(report)).status,409);
  await db.prepare("UPDATE feed_state SET next_poll_at=0 WHERE id='aircraft-adsbfi-fast-budget'").run();const next=await (await call({action:"lease"})).json();
  await call({action:"report",pollId:next.pollId,requestCount:1,statusCode:429,retryAfter:"7200"});assert.equal((await (await call({action:"lease"})).json()).acquired,false);
  const state=await db.prepare("SELECT requests,blocked_until FROM feed_state WHERE id='aircraft-adsbfi-fast-budget'").first();assert.equal(state.requests,2);assert.ok(state.blocked_until>Date.now()+7190000);
  await db.prepare("UPDATE feed_state SET requests=2880,blocked_until=0,next_poll_at=0 WHERE id='aircraft-adsbfi-fast-budget'").run();assert.equal((await (await call({action:"lease"})).json()).acquired,false);
 }finally{await mf.dispose();}
});


test("cold-start recovery leaves room for the server response and never falsely reports an old fix as receiving",async()=>{
 assert.ok(FAST_CONNECT_TIMEOUT_MS>8000);assert.ok(FAST_CLIENT_TIMEOUT_MS>FAST_CONNECT_TIMEOUT_MS);
 let now=Date.now(),reported=false;const timers=[];
 const collector=createFastCollector({siteUrl:"https://site.test",token,fleet,clock:()=>now,schedule:(callback,delay)=>{timers.push({callback,delay});return timers.length;},fetcher:async(input,init)=>{
  if(new URL(input).hostname==="site.test"){const body=JSON.parse(init.body);if(body.action==="lease")return Response.json({acquired:true,pollId:"wake",url:`https://opendata.adsb.fi/api/v2/icao/${plane.icao_hex}`,expiresAt:now+30000,intervalMs:2100,maximumRequests:1});reported=true;return Response.json({accepted:true});}
  return Response.json({now,ac:[ac]});
 }});
 collector.demand();for(let i=0;i<30&&!reported;i++)await flush();
 assert.equal(collector.view().status,"receiving");const stamp=collector.view().fetchedAt;now+=16000;assert.equal(collector.view().status,"waiting");assert.equal(collector.view().fetchedAt,stamp);collector.stop();
});
