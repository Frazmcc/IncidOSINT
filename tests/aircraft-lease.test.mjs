import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {Miniflare} from './helpers/miniflare.mjs';

test('The real aircraft service API authenticates leases, shares its budget with map viewers and accepts a poll report once',async()=>{
 const compiled=await build({stdin:{contents:'import {POST} from "./app/api/collector/aircraft/route.ts";import {aircraftSnapshot} from "./lib/live-store.ts";export default {async fetch(r){return new URL(r.url).pathname==="/live"?Response.json(await aircraftSnapshot()):POST(r);}}',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',mainFields:["module","main"],external:['cloudflare:workers'],write:false});
 let upstream=0;
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-22',d1Databases:{DB:'aircraft-test'},bindings:{VESSEL_INGEST_TOKEN:'synthetic-control-token',ADSB_LOL_FREE_KEY:'synthetic-provider-key',ADSB_FI_ENABLED:'false'},outboundService:()=>{upstream++;throw Error('Map requests must use the worker cache, never upstream.');}});
 try{
  const db=await mf.getD1Database('DB');
  for(const name of ['0000_wealthy_wild_child.sql','0001_burly_ink.sql']){
   let sql;try{sql=await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8');}catch{if(name.startsWith('0000')){const {readdir}=await import('node:fs/promises');const actual=(await readdir(new URL('../drizzle/',import.meta.url))).find(n=>n.startsWith('0000_'));sql=await readFile(new URL('../drizzle/'+actual,import.meta.url),'utf8');}else throw Error('Missing trail migration.');}
   for(const statement of sql.replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  const call=body=>mf.dispatchFetch('https://site.test/collector',{method:'POST',headers:{Authorization:'Bearer synthetic-control-token','Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await mf.dispatchFetch('https://site.test/collector',{method:'POST',body:'{}'})).status,401);
  const replies=await Promise.all(Array.from({length:30},()=>call({action:'lease'}).then(r=>r.json())));
  const leases=replies.filter(x=>x.acquired);assert.equal(leases.length,1);assert.equal(leases[0].apiKey,'synthetic-provider-key');
  for(const reply of replies.filter(x=>!x.acquired))assert.equal(reply.apiKey,undefined);
  const fleet=JSON.parse(await readFile(new URL('../data/aircraft.json',import.meta.url)));
  const ac={hex:fleet[0].icao_hex,r:fleet[0].registration,lat:55.8,lon:-4.2,seen_pos:0,alt_baro:1000};
  const report={action:'report',pollId:leases[0].pollId,statusCode:200,payload:{now:Date.now(),ac:[ac]}};
  assert.equal((await (await call(report)).json()).accepted,true);
  assert.equal((await call(report)).status,409,'A report cannot replay its lease.');
  for(let i=0;i<20;i++){
   const response=await mf.dispatchFetch('https://site.test/live');assert.equal(response.status,200);
   const data=await response.json();assert.equal(data.collectionMode,'background');assert.equal(data.records.length,1);assert.equal(data.apiKey,undefined);
  }
  assert.equal(upstream,0);
  const budget=await db.prepare("SELECT requests FROM feed_state WHERE id='aircraft-adsblol'").first();assert.equal(budget.requests,1);
  await db.prepare("UPDATE feed_state SET requests=990,next_poll_at=0 WHERE id='aircraft-adsblol'").run();
  assert.equal((await (await call({action:'lease'})).json()).acquired,false);
 }finally{await mf.dispose();}
});
