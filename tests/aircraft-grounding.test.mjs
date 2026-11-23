import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {Miniflare} from "miniflare";
import {readFile,readdir} from "node:fs/promises";

test("the real aircraft API preserves old ground reports across empty collector polls and replaces them on take-off",async()=>{
  const compiled=await build({stdin:{contents:`import {aircraftSnapshot,recordAircraftPayload} from "./lib/live-store.ts";export default {async fetch(r){if(r.method==="POST")return Response.json(await recordAircraftPayload(await r.json()));return Response.json(await aircraftSnapshot());}}`,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],external:["cloudflare:workers"],write:false});
  let upstream=0;
  const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",d1Databases:{DB:"ground-aircraft"},outboundService:()=>{upstream++;throw Error("Ground retention must not poll another API");}});
  try{
    const db=await mf.getD1Database("DB");
    for(const name of (await readdir(new URL("../drizzle/",import.meta.url))).filter(n=>n.endsWith(".sql")).sort()){
      const sql=await readFile(new URL("../drizzle/"+name,import.meta.url),"utf8");
      for(const statement of sql.replace(/--> statement-breakpoint/g,"").split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
    }
    const now=Date.now(),fleet=JSON.parse(await readFile(new URL("../data/aircraft.json",import.meta.url),"utf8"));
    const raw={hex:fleet[0].icao_hex,r:fleet[0].registration,lat:55.8,lon:-4.2,seen:0,seen_pos:0,alt_baro:"ground"};
    const capture=ac=>mf.dispatchFetch("https://site.test/capture",{method:"POST",body:JSON.stringify({now:Date.now(),ac})}).then(r=>r.json());
    const first=await capture([raw]);assert.equal(first.records[0].onGround,true);
    const stored=await db.prepare("SELECT snapshot FROM feed_state WHERE id='aircraft-adsblol'").first();
    const snapshot=JSON.parse(stored.snapshot);snapshot.records[0].observedAt=now-86400000;
    snapshot.records.push({...snapshot.records[0],id:`air-${fleet[1].icao_hex}`,identifier:fleet[1].icao_hex,name:fleet[1].registration,onGround:false});
    await db.prepare("UPDATE feed_state SET snapshot=? WHERE id='aircraft-adsblol'").bind(JSON.stringify(snapshot)).run();
    await db.prepare("INSERT INTO feed_state(id,snapshot,fetched_at) VALUES('aircraft-worker','{}',?)").bind(Date.now()).run();
    const empty=await capture([]);assert.equal(empty.records.length,1);assert.equal(empty.records[0].observedAt,now-86400000);
    for(let i=0;i<3;i++){
      const live=await (await mf.dispatchFetch("https://site.test/live")).json();
      assert.equal(live.records.length,1);assert.equal(live.records[0].onGround,true);assert.equal(live.records[0].observedAt,now-86400000);
    }
    const airborne=await capture([{...raw,lat:55.9,alt_baro:1000,gs:80}]);
    assert.equal(airborne.records.length,1);assert.equal(airborne.records[0].onGround,false);assert.equal(airborne.records[0].lat,55.9);
    const live=await (await mf.dispatchFetch("https://site.test/live")).json();assert.equal(live.records[0].onGround,false);
    assert.equal(upstream,0);
  }finally{await mf.dispose();}
});
