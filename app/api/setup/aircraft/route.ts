import { getChatGPTUser } from "../../../chatgpt-auth";
import { runtimeEnv } from "../../../../lib/live-store";
import { encryptAircraftKey, readAircraftKey } from "../../../../lib/aircraft-key.mjs";
import { aircraftPolicy, normalizeAircraft, mergeAircraftSnapshots, retryDelay } from "../../../../lib/tracking-core.mjs";
import {aircraftBudget,aircraftReservationArgs,RESERVE_AIRCRAFT_SQL} from "../../../../lib/aircraft-budget.mjs";
import { fetchWithoutRedirect } from "../../../../lib/edge-fetch.mjs";
import {ownerAllowed,setupRequestAllowed} from "../../../../lib/site-security.mjs";
import { captureAircraftTrails } from "../../../../lib/trail-store";
import aircraft from "../../../../data/aircraft.json";
export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store, private"}});
const config=()=>runtimeEnv() as ReturnType<typeof runtimeEnv>&{COLLECTOR_OWNER_EMAIL?:string};
async function owner(){const user=await getChatGPTUser();return ownerAllowed(user,config().COLLECTOR_OWNER_EMAIL);}

export async function GET(){
  if(!await owner())return json({error:"Sign in with the website owner’s ChatGPT account."},403);
  const env=config(),saved=await readAircraftKey(env.DB,env.AIRCRAFT_KEY_SECRET);
  return json({ready:Boolean(env.DB&&env.AIRCRAFT_KEY_SECRET),configured:Boolean(saved||env.ADSB_LOL_FREE_KEY),tier:saved?.tier||null,configuredAt:saved?.configuredAt||null});
}
export async function POST(request:Request){
  if(!await owner())return json({error:"Only the signed-in website owner can connect an aircraft key."},403);
  if(!setupRequestAllowed(request))return json({error:"Use this website’s private aircraft connection screen."},403);
  if(Number(request.headers.get("Content-Length")||0)>2000)return json({error:"Request too large."},413);
  const raw=await request.text();if(raw.length>2000)return json({error:"Request too large."},413);
  let body:any;try{body=JSON.parse(raw);}catch{return json({error:"Invalid connection details."},400);}
  if(!body||typeof body.apiKey!=="string"||body.apiKey.length<20||body.apiKey.length>512||/\s/.test(body.apiKey)||!["anonymous","adhoc"].includes(body.tier)||body.freeConfirmed!==true)return json({error:"Enter your free adsb.lol key, choose its free tier and confirm it is free."},400);
  const env=config(),db=env.DB;
  if(!db||!env.AIRCRAFT_KEY_SECRET)return json({error:"Private aircraft-key storage is not configured."},503);
  const now=Date.now();
  await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES('aircraft-key-validation','{}') ON CONFLICT(id) DO NOTHING").run();
  const lease=await db.prepare("UPDATE feed_state SET next_poll_at=? WHERE id='aircraft-key-validation' AND next_poll_at<=? RETURNING id").bind(now+180_000,now).first();
  if(!lease)return json({error:"A key check has already run recently. Wait three minutes before testing again."},429);
  try{
    const policy=aircraftPolicy("adsblol",true,body.tier);
    const existing=await readAircraftKey(db,env.AIRCRAFT_KEY_SECRET);
    const checkPolicy=aircraftPolicy("adsblol",true,existing?.tier==="anonymous"?"anonymous":body.tier);
    await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES('aircraft-adsblol','{\"records\":[]}') ON CONFLICT(id) DO NOTHING").run();
    const reserved=await db.prepare(RESERVE_AIRCRAFT_SQL).bind(...aircraftReservationArgs(checkPolicy,Date.now(),true)).first();
    if(!reserved){
      const state=await db.prepare("SELECT window_start,requests,next_poll_at,blocked_until FROM feed_state WHERE id='aircraft-adsblol'").first();
      const budget=aircraftBudget(checkPolicy,state);
      return json({error:"The shared aircraft allowance is paused. The key check has not contacted the provider.",nextPollAt:budget.nextPollAt},429);
    }
    const hexes=[...new Set(aircraft.map(r=>r.icao_hex))].join(",");
    const response=await fetchWithoutRedirect(policy.url+hexes,{headers:{"x-api-key":body.apiKey,"User-Agent":"Logic-Emergency-Air-Sea/1.0"},signal:AbortSignal.timeout(20_000)});
    if(!response.ok){
      const until=Date.now()+retryDelay(response);
      if(response.status===429)await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id='aircraft-adsblol'").bind(until,"Key validation returned HTTP 429; collection paused.").run();
      return json({error:`adsb.lol returned HTTP ${response.status}. The new key has not been saved. Check its status on the provider’s My keys page.`},400);
    }
    const received=normalizeAircraft(await response.json(),aircraft);
    const encrypted=await encryptAircraftKey(body.apiKey,env.AIRCRAFT_KEY_SECRET,body.tier);
    const previous=await db.prepare("SELECT snapshot FROM feed_state WHERE id='aircraft-adsblol'").first<{snapshot:string}>();
    const snapshot=mergeAircraftSnapshots(received,JSON.parse(previous?.snapshot||'{"records":[]}'),Date.now(),aircraft);
    const time=Date.now();
    await db.batch([
      db.prepare("INSERT INTO feed_state(id,snapshot,fetched_at) VALUES('aircraft-api-key',?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,fetched_at=excluded.fetched_at").bind(JSON.stringify(encrypted),time),
      db.prepare("UPDATE feed_state SET snapshot=?,fetched_at=?,last_error=CASE WHEN blocked_until<=? THEN NULL ELSE last_error END WHERE id='aircraft-adsblol'").bind(JSON.stringify(snapshot),time,time),
    ]);
    try{await captureAircraftTrails(received.records);}catch{ /* Positions remain available if the trail budget is paused. */ }
    return json({ok:true,configured:true,tier:body.tier,message:`Free aircraft key connected. ${snapshot.records.length} recent aircraft positions received. The map will use one shared feed within the ${policy.limit}-request daily budget.`});
  }catch{return json({error:"The aircraft provider could not be reached or returned an invalid response. The new key has not been saved."},502);}
}
