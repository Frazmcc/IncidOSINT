import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFile} from "node:fs/promises";
import {build} from "esbuild";
import {Miniflare} from "./helpers/miniflare.mjs";
import {retryDelay,MAX_RETRY_DELAY_MS,REPAIR_RETRY_AFTER_SQL,retryRepairArgs,DAY_MS} from "../lib/tracking-core.mjs";
const now=Date.UTC(2026,10,27,23,0,0);
const response=(value,status=429)=>new Response(null,{status,headers:{"Retry-After":value}});

test("Retry-After preserves real seconds and HTTP dates, and recognises near-future epoch timestamps",()=>{
 assert.equal(retryDelay(response("7200"),now),7_200_000);
 assert.equal(retryDelay(response(new Date(now+7_200_000).toUTCString()),now),7_200_000);
 assert.equal(retryDelay(response(String((now+7_200_000)/1000)),now),7_200_000);
 assert.equal(retryDelay(response(String(now+7_200_000)),now),7_200_000);
 assert.equal(retryDelay(response("172800"),now),2*DAY_MS);
 assert.equal(retryDelay(response("0"),now),180_000);
});

test("malformed retry values cannot create year-93895 pauses, infinite waits or timer overflows",()=>{
 for(const value of ["2899108619520","999999999999999999999","1e300","Infinity","-1","not a date",new Date(2900904364799973).toUTCString()]){
  const delay=retryDelay(response(value),now);assert.equal(delay,3_600_000,value);assert.ok(delay<=MAX_RETRY_DELAY_MS);assert.ok(delay<2_147_483_647);
 }
 assert.equal(retryDelay(response("invalid",403),now),DAY_MS);
});

test("repair affects only impossible HTTP 429 deadlines and preserves request counters and genuine cooldowns",()=>{
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE feed_state(id TEXT PRIMARY KEY,requests INTEGER,window_start INTEGER,next_poll_at INTEGER,blocked_until INTEGER,last_error TEXT)");
 const add=db.prepare("INSERT INTO feed_state VALUES(?,42,?, ?,?,?)");
 add.run("broken",now-23*3_600_000,now-21*3_600_000,2900904364799973,"Provider returned HTTP 429; collection paused.");
 add.run("genuine",now-23*3_600_000,now,now+2*DAY_MS,"Provider returned HTTP 429; collection paused.");
 add.run("refused",now-23*3_600_000,now,2900904364799973,"Provider returned HTTP 403; collection paused.");
 const repair=db.prepare(REPAIR_RETRY_AFTER_SQL);
 assert.ok(repair.get(...retryRepairArgs("broken",now)));assert.equal(repair.get(...retryRepairArgs("broken",now)),undefined);
 const fixed=db.prepare("SELECT * FROM feed_state WHERE id='broken'").get();assert.ok(fixed.blocked_until<now);assert.equal(fixed.requests,42);assert.equal(fixed.window_start,now-23*3_600_000);
 assert.equal(repair.get(...retryRepairArgs("genuine",now)),undefined);assert.equal(repair.get(...retryRepairArgs("refused",now)),undefined);
 db.close();
});

test("an authenticated real collector recovers a corrupted production-shaped row once and keeps its daily budget",async()=>{
 const compiled=await build({stdin:{contents:'import {POST} from "./app/api/collector/aircraft/route.ts";export default{fetch:POST};',resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],external:["cloudflare:workers"],write:false});
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",d1Databases:{DB:"retry-recovery"},bindings:{VESSEL_INGEST_TOKEN:"synthetic-retry-token",ADSB_LOL_FREE_KEY:"synthetic-provider-key",ADSB_FI_ENABLED:"false"},outboundService:()=>{throw Error("A lease must not query a provider");}});
 try{
  const db=await mf.getD1Database("DB");
  for(const filename of ["0000_light_random.sql","0001_burly_ink.sql","0002_amazing_warhawk.sql"]){const sql=await readFile(new URL(`../drizzle/${filename}`,import.meta.url),"utf8");for(const statement of sql.replace(/--> statement-breakpoint/g,"").split(";").map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();}
  const time=Date.now(),start=Math.floor(time/DAY_MS)*DAY_MS;
  await db.prepare("INSERT INTO feed_state(id,snapshot,fetched_at,next_poll_at,window_start,requests,blocked_until,last_error) VALUES('aircraft-adsblol','{}',?,?,?,42,?,?)").bind(time-21*3_600_000,time-21*3_600_000,start,2900904364799973,"Provider returned HTTP 429; collection paused.").run();
  assert.equal((await mf.dispatchFetch("https://site.test/collector",{method:"POST",body:'{"action":"lease"}'})).status,401);
  const call=body=>mf.dispatchFetch("https://site.test/collector",{method:"POST",headers:{Authorization:"Bearer synthetic-retry-token"},body:JSON.stringify(body)});
  const replies=await Promise.all(Array.from({length:20},()=>call({action:"lease"}).then(r=>r.json()))),leases=replies.filter(r=>r.acquired);assert.equal(leases.length,1);
  assert.equal((await db.prepare("SELECT requests FROM feed_state WHERE id='aircraft-adsblol'").first()).requests,43);
  await call({action:"report",pollId:leases[0].pollId,statusCode:429,retryAfter:"2899108619520"});
  const paused=await db.prepare("SELECT requests,blocked_until FROM feed_state WHERE id='aircraft-adsblol'").first();assert.equal(paused.requests,43);assert.ok(paused.blocked_until<=Date.now()+3_600_000);assert.ok(paused.blocked_until>Date.now()+3_590_000);
  assert.equal((await (await call({action:"lease"})).json()).acquired,false);
 }finally{await mf.dispose();}
});
