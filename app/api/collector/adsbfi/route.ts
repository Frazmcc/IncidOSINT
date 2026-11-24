import {parseJsonObject} from "../../../../lib/json-input";
import type {FeedBudgetRow} from "../../../../lib/tracking-types";
import {runtimeEnv,recordAircraftPayload} from "../../../../lib/live-store";
import {RESERVE_POLL_SQL,DAY_MS,retryDelay} from "../../../../lib/tracking-core.mjs";
import {FAST_POLL_MS,FAST_LEASE_MS,FAST_BATCH_REQUESTS,FAST_DAILY_LEASES,FAST_DAILY_REQUESTS,FAST_BUDGET_ID} from "../../../../lib/aircraft-fast-policy.mjs";
import fleet from "../../../../data/aircraft.json";
export const dynamic="force-dynamic";
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store, private"}});
export async function POST(request:Request){
 const env=runtimeEnv(),db=env.DB;
 if(!env.ADSB_FI_COLLECTOR_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.ADSB_FI_COLLECTOR_TOKEN}`)return json({error:"Unauthorized"},401);
 if(!db)return json({error:"Aircraft storage is unavailable"},503);
 if(Number(request.headers.get("Content-Length")||0)>1_500_000)return json({error:"Report too large"},413);
 const raw=await request.text();if(raw.length>1_500_000)return json({error:"Report too large"},413);
 let body;try{body=parseJsonObject(raw);}catch{return json({error:"Invalid JSON"},400);}
 if(!body||typeof body.action!=="string"||!["lease","report"].includes(body.action))return json({error:"Unknown action"},400);
 const now=Date.now();
 await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES(?, '{}') ON CONFLICT(id) DO NOTHING").bind(FAST_BUDGET_ID).run();
 if(body.action==="lease"){
  const acquired=await db.prepare(RESERVE_POLL_SQL).bind(now+FAST_LEASE_MS,now-DAY_MS,now,FAST_BUDGET_ID,FAST_DAILY_LEASES).first();
  if(!acquired){
   const row=await db.prepare("SELECT next_poll_at,blocked_until,window_start,requests FROM feed_state WHERE id=?").bind(FAST_BUDGET_ID).first<FeedBudgetRow>();
   return json({acquired:false,nextPollAt:Math.max(row?.next_poll_at||0,row?.blocked_until||0,row&&row.requests>=FAST_DAILY_LEASES?row.window_start+DAY_MS:0)});
  }
  const lease={pollId:crypto.randomUUID(),issuedAt:now,expiresAt:now+FAST_LEASE_MS,maximumRequests:FAST_BATCH_REQUESTS,intervalMs:FAST_POLL_MS};
  await db.prepare("UPDATE feed_state SET snapshot=?,fetched_at=? WHERE id=?").bind(JSON.stringify(lease),now,FAST_BUDGET_ID).run();
  return json({acquired:true,...lease,requestLimit:FAST_DAILY_REQUESTS,url:"https://opendata.adsb.fi/api/v2/icao/"+fleet.map(a=>a.icao_hex).join(",")});
 }
 const row=await db.prepare("SELECT snapshot FROM feed_state WHERE id=?").bind(FAST_BUDGET_ID).first<{snapshot:string}>();
 let lease;try{lease=parseJsonObject(row?.snapshot||"{}");}catch{return json({error:"Invalid lease"},409);}
 if(!lease?.pollId||typeof lease.expiresAt!=="number"||body.pollId!==lease.pollId||now>lease.expiresAt+10_000)return json({error:"Lease expired"},409);
 const claimed=await db.prepare("UPDATE feed_state SET snapshot='{}' WHERE id=? AND snapshot=? RETURNING id").bind(FAST_BUDGET_ID,row!.snapshot).first();
 if(!claimed)return json({error:"Lease already reported"},409);
 const count=body.requestCount;
 if(typeof count!=="number"||!Number.isInteger(count)||count<0||count>FAST_BATCH_REQUESTS)return json({error:"Invalid request count"},400);
 if(body.statusCode!==200){
  const status=typeof body.statusCode==="number"&&Number.isInteger(body.statusCode)&&body.statusCode>=400&&body.statusCode<=599?body.statusCode:502;
  const headers=new Headers();if(typeof body.retryAfter==="string"&&body.retryAfter.length<100)headers.set("Retry-After",body.retryAfter);
  const until=now+retryDelay(new Response(null,{status,headers}));
  const message=status===403?"adsb.fi refused access from the aircraft collector (HTTP 403).":`adsb.fi returned HTTP ${status}; collection paused.`;
  await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id=?").bind(until,message,FAST_BUDGET_ID).run();
  return json({accepted:false,nextPollAt:until});
 }
 try{
  const result=await recordAircraftPayload(body.payload,"adsbfi",Array.isArray(body.history)?body.history.slice(-2500):[]);
  await db.prepare("UPDATE feed_state SET blocked_until=0,last_error=NULL WHERE id=?").bind(FAST_BUDGET_ID).run();
  return json({accepted:true,positions:result.records.length});
 }catch{return json({error:"Invalid aircraft report"},400);}
}
