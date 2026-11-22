import {runtimeEnv,recordAircraftPayload} from "../../../../lib/live-store";
import {readAircraftKey} from "../../../../lib/aircraft-key.mjs";
import {aircraftPolicy,RESERVE_POLL_SQL,DAY_MS,retryDelay} from "../../../../lib/tracking-core.mjs";
import fleet from "../../../../data/aircraft.json";
export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store, private"}});
export async function POST(request:Request){
  const env=runtimeEnv(),token=env.VESSEL_INGEST_TOKEN,db=env.DB;
  if(!token||request.headers.get("Authorization")!==`Bearer ${token}`)return json({error:"Unauthorized"},401);
  if(!db)return json({error:"Shared feed storage unavailable"},503);
  if(Number(request.headers.get("Content-Length")||0)>1_500_000)return json({error:"Report too large"},413);
  const raw=await request.text();if(raw.length>1_500_000)return json({error:"Report too large"},413);
  let body:any;try{body=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
  if(!body||!["lease","report"].includes(body.action))return json({error:"Unknown action"},400);
  const now=Date.now(),stored=await readAircraftKey(db,env.AIRCRAFT_KEY_SECRET),key=stored?.value||env.ADSB_LOL_FREE_KEY;
  const policy=aircraftPolicy("adsblol",Boolean(key),stored?.tier||"adhoc");
  if(body.action==="lease"){
    await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES('aircraft-adsblol','{\"records\":[]}') ON CONFLICT(id) DO NOTHING").run();
    await db.prepare("INSERT INTO feed_state(id,snapshot,fetched_at) VALUES('aircraft-worker','{}',?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at").bind(now).run();
    const reserved=await db.prepare(RESERVE_POLL_SQL).bind(now+policy.intervalMs,now-DAY_MS,now,"aircraft-adsblol",policy.limit).first();
    if(!reserved){
      const state=await db.prepare("SELECT next_poll_at,blocked_until,window_start,requests,last_error FROM feed_state WHERE id='aircraft-adsblol'").first<any>();
      return json({acquired:false,nextPollAt:Math.max(state?.next_poll_at||0,state?.blocked_until||0,state?.requests>=policy.limit?state.window_start+DAY_MS:0),message:state?.last_error||"Waiting for the next shared poll.",requestsUsed:state?.requests||0,requestLimit:policy.limit});
    }
    const pollId=crypto.randomUUID();
    await db.prepare("UPDATE feed_state SET snapshot=? WHERE id='aircraft-worker'").bind(JSON.stringify({pollId,issuedAt:now,keyRevision:stored?.configuredAt||0})).run();
    // Only the authenticated backend collector receives this temporary key.
    return json({acquired:true,pollId,url:policy.url+fleet.map(r=>r.icao_hex).join(","),apiKey:key||null,intervalMs:policy.intervalMs,requestLimit:policy.limit});
  }
  const row=await db.prepare("SELECT snapshot FROM feed_state WHERE id='aircraft-worker'").first<{snapshot:string}>();
  let lease:any;try{lease=JSON.parse(row?.snapshot||"{}");}catch{return json({error:"Invalid poll lease"},409);}
  if(!lease.pollId||body.pollId!==lease.pollId||now-lease.issuedAt>90_000||(stored?.configuredAt||0)!==lease.keyRevision)return json({error:"Poll lease expired or key changed"},409);
  // A lease is single-use, including provider failures.
  const claimed=await db.prepare("UPDATE feed_state SET snapshot='{}' WHERE id='aircraft-worker' AND snapshot=? RETURNING id").bind(row!.snapshot).first();
  if(!claimed)return json({error:"Poll lease already used"},409);
  if(body.statusCode!==200){
    const status=Number.isInteger(body.statusCode)&&body.statusCode>=400&&body.statusCode<=599?body.statusCode:502;
    const headers=new Headers();if(typeof body.retryAfter==="string"&&body.retryAfter.length<100)headers.set("Retry-After",body.retryAfter);
    const delay=retryDelay(new Response(null,{status,headers}));
    await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id='aircraft-adsblol'").bind(now+delay,`Provider returned HTTP ${status}; collection paused.`).run();
    return json({accepted:false,statusCode:status,nextPollAt:now+delay});
  }
  try{const result=await recordAircraftPayload(body.payload);return json({accepted:true,positions:result.records.length});}
  catch{await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id='aircraft-adsblol'").bind(now+180_000,"Aircraft provider returned an invalid response; collection paused.").run();return json({error:"Invalid aircraft payload"},400);}
}
