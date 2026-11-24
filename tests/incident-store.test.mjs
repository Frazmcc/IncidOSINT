import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {readFile,readdir} from "node:fs/promises";

test("shared incident sources fetch once across viewers, preserve old items, honour source caps and stop before the write budget",async()=>{
 const compiled=await build({stdin:{contents:`import {env} from "cloudflare:workers";import {GET} from "./app/api/incidents/route.ts";import {captureAssetActivity} from "./lib/incident-store.ts";export default {async fetch(r){if(new URL(r.url).pathname==="/activity"){await captureAssetActivity(env.DB,await r.json());return Response.json({ok:true});}return GET();}}`,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],external:["cloudflare:workers"],write:false});
 let requests=0,mode="normal";const hosts=[];
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",d1Databases:{DB:"incident-test"},bindings:{ADSB_LOL_FREE_KEY:"synthetic-provider-secret",VESSEL_INGEST_TOKEN:"synthetic-control-secret"},outboundService:request=>{
  const host=new URL(request.url).hostname;hosts.push(host);requests++;assert.ok(["traffic.wales","rss.trafficwatchni.com","rnli.org"].includes(host));
  for(const name of ["Authorization","OAI-Sites-Authorization","x-api-key"])assert.equal(request.headers.get(name),null);
  if(mode==="rate")return new Response("Rate limited",{status:429,headers:{"Retry-After":"7200"}});
  if(mode==="redirect")return new Response(null,{status:302,headers:{Location:"https://unexpected.test/capture"}});
  if(host==="rnli.org")return new Response(`<div data-rnli-map-data data-json='{"Results":[],"SolrFailed":false}'></div>`,{headers:{"Content-Type":"text/html"}});
  const date=new Date(Date.now()-(host==="traffic.wales"?60000:30*86400000)).toUTCString();
  return new Response(`<rss><channel><title>Official incident feed</title><link>https://${host}/</link><pubDate>${new Date().toUTCString()}</pubDate><item><title>Road collision</title><guid>reported-1</guid><pubDate>${date}</pubDate><description>Road restricted after a collision.</description></item></channel></rss>`,{headers:{"Content-Type":"application/rss+xml"}});
 }});
 try{
  const db=await mf.getD1Database("DB"),first=(await readdir(new URL("../drizzle/",import.meta.url))).find(n=>n.startsWith("0000_")&&n.endsWith(".sql"));
  const sql=await readFile(new URL("../drizzle/"+first,import.meta.url),"utf8");for(const statement of sql.replace(/--> statement-breakpoint/g,"").split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  const responses=await Promise.all(Array.from({length:25},()=>mf.dispatchFetch("https://site.test/api/incidents").then(r=>r.json())));
  assert.equal(requests,3);let snapshot=await (await mf.dispatchFetch("https://site.test/api/incidents")).json();assert.equal(snapshot.events.length,1);assert.equal(snapshot.events[0].confidence,"reported");assert.equal(snapshot.events[0].lat,null);
  assert.equal(snapshot.sources.find(s=>s.id==="traffic-ni").status,"stale");assert.equal(snapshot.sources.find(s=>s.id==="rnli").status,"receiving");assert.ok(responses.every(r=>!r.error));
  const originalTime=snapshot.events[0].eventAt;
  await db.prepare("UPDATE feed_state SET requests=288,next_poll_at=0 WHERE id LIKE 'incident-source-%'").run();await mf.dispatchFetch("https://site.test/api/incidents");assert.equal(requests,3);
  await db.prepare("UPDATE feed_state SET requests=0,next_poll_at=0 WHERE id LIKE 'incident-source-%'").run();mode="rate";const before=Date.now();await mf.dispatchFetch("https://site.test/api/incidents");assert.equal(requests,6);
  const paused=await db.prepare("SELECT blocked_until FROM feed_state WHERE id='incident-source-traffic-wales'").first();assert.ok(paused.blocked_until>=before+7199000);
  snapshot=await (await mf.dispatchFetch("https://site.test/api/incidents")).json();assert.equal(snapshot.events[0].eventAt,originalTime);assert.equal(requests,6);
  await db.prepare("UPDATE feed_state SET blocked_until=0,next_poll_at=0 WHERE id LIKE 'incident-source-%'").run();mode="redirect";await mf.dispatchFetch("https://site.test/api/incidents");assert.equal(requests,9);assert.ok(!hosts.includes("unexpected.test"));
  await db.prepare("INSERT INTO feed_state(id,snapshot,window_start,requests) VALUES('incident-write-budget','{}',?,6000) ON CONFLICT(id) DO UPDATE SET requests=6000,window_start=excluded.window_start").bind(Date.now()).run();
  await db.prepare("UPDATE feed_state SET blocked_until=0,next_poll_at=0 WHERE id LIKE 'incident-source-%'").run();mode="normal";
  snapshot=await (await mf.dispatchFetch("https://site.test/api/incidents")).json();assert.equal(snapshot.writeBudget.paused,true);assert.equal(requests,9);
  await db.prepare("UPDATE feed_state SET window_start=? WHERE id='incident-write-budget'").bind(Date.now()-86400001).run();
  const at=Date.now(),asset={id:"air-test",kind:"aircraft",identifier:"test",name:"TEST",category:"Police",territory:"United Kingdom",lat:55.8,lon:-4.2,observedAt:at,squawk:"0032",squawkObservedAt:at,onGround:false,speed:90};
  assert.equal((await mf.dispatchFetch("https://site.test/activity",{method:"POST",body:JSON.stringify([asset])})).status,200);
  snapshot=await (await mf.dispatchFetch("https://site.test/api/incidents")).json();assert.equal(snapshot.writeBudget.paused,false);assert.ok(snapshot.events.some(e=>e.confidence==="inferred"&&e.assetName==="TEST"));

  const now=Date.now(),air={id:"air-test",identifier:"test",name:"TEST",kind:"aircraft",category:"Police",territory:"United Kingdom",squawk:"0032",squawkObservedAt:now,observedAt:now,lat:55,lon:-4,speed:90,onGround:false};
  await mf.dispatchFetch("https://site.test/activity",{method:"POST",body:JSON.stringify([air])});snapshot=await (await mf.dispatchFetch("https://site.test/api/incidents")).json();assert.equal(snapshot.events.filter(e=>e.confidence==="inferred").length,1);
  const beforePause=requests;
  await db.prepare("UPDATE feed_state SET requests=6000,window_start=? WHERE id='incident-write-budget'").bind(Date.now()).run();await db.prepare("UPDATE feed_state SET blocked_until=0,next_poll_at=0 WHERE id LIKE 'incident-source-%'").run();
  await mf.dispatchFetch("https://site.test/activity",{method:"POST",body:JSON.stringify([{...air,id:"air-other",identifier:"other"}])});snapshot=await (await mf.dispatchFetch("https://site.test/api/incidents")).json();assert.equal(requests,beforePause);assert.equal(snapshot.writeBudget.paused,true);assert.equal(snapshot.events.filter(e=>e.confidence==="inferred").length,1);
 }finally{await mf.dispose();}
});
