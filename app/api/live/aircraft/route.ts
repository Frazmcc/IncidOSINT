import {parseJsonObject} from "../../../../lib/json-input";
import type {FastAircraftFeed,Track} from "../../../../lib/tracking-types";
import {runtimeEnv} from "../../../../lib/live-store";
import {combineAircraftSnapshots} from "../../../../lib/aircraft-fusion.mjs";
import {fetchWithoutRedirect} from "../../../../lib/edge-fetch.mjs";
import {groupFor} from "../../../../lib/tracking-core.mjs";
import fleet from "../../../../data/aircraft.json";
export const dynamic="force-dynamic";
let memo:{at:number;body:FastAircraftFeed}|null=null,pending:Promise<FastAircraftFeed>|null=null;
export async function GET(request:Request){
 const env=runtimeEnv(),origin=env.ADSB_FI_FAST_URL,token=env.ADSB_FI_COLLECTOR_TOKEN;
 const headers={"Cache-Control":"public, max-age=0, s-maxage=2","X-Content-Type-Options":"nosniff"};
 if(!origin||!token)return Response.json({enabled:false}, {headers:{"Cache-Control":"public, max-age=0, s-maxage=60"}});
 let url:URL;try{url=new URL("/snapshot",origin);if(url.protocol!=="https:"||!/^([a-z0-9-]+\.)?onrender\.com$/.test(url.hostname)||url.username||url.password||url.port)throw Error();}catch{return Response.json({enabled:false},{headers});}
 const cache=(caches as CacheStorage&{default?:Cache}).default,key=new Request(new URL("/api/live/aircraft",request.url).href);
 try{const hit=await cache?.match(key);if(hit)return hit;}catch{}
 const now=Date.now();
 if(!memo||now-memo.at>=2_000){
  pending ||= (async()=>{
   try{
    const response=await fetchWithoutRedirect(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8_000)});
    if(!response.ok)throw Error();const raw=await response.text();if(raw.length>500_000)throw Error();
    const value=parseJsonObject(raw);if(!value)throw Error();const known=new Map(fleet.map(a=>[a.icao_hex,a]));
    const fields=["id","kind","identifier","name","lat","lon","observedAt","receivedAt","speed","heading","altitude","onGround","squawk","squawkObservedAt","typeCode","timeBasis","lastSeenAt","callsign"];
    const pick=(value:unknown)=>{const r=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};return Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));};
    const records=Array.isArray(value.records)?value.records.slice(0,200).map(pick):[];
    const unpositioned=Array.isArray(value.unpositioned)?value.unpositioned.slice(0,200).map(pick).filter(r=>typeof r.identifier==="string"&&known.has(r.identifier)&&typeof r.lastSeenAt==="number"&&Number.isFinite(r.lastSeenAt)&&Date.now()-r.lastSeenAt<=120_000&&r.lastSeenAt<=Date.now()+60_000):[];
    const filtered=combineAircraftSnapshots([{records,unpositioned}],Date.now(),fleet);
    filtered.records=filtered.records.map((r:Track)=>{const meta=known.get(r.identifier)!;return {...r,service:meta.service,category:groupFor(meta.category),fleetCategory:meta.category,territory:meta.territory,typeCode:meta.type_code||r.typeCode,notes:meta.notes,fleetStatus:meta.fleet_status,sourceUrl:meta.identity_source,fleetSource:meta.fleet_source,feedProvider:"adsb.fi"};});
    return {enabled:true,...filtered,fetchedAt:Number(value.fetchedAt)||null,nextPollAt:Number(value.nextPollAt)||null,status:typeof value.status==="string"&&["receiving","waiting","paused"].includes(value.status)?value.status:"waiting",message:String(value.message||"").slice(0,200),intervalSeconds:2.1};
   }catch{return {enabled:true,records:[],unpositioned:[],status:"waiting",message:"The free aircraft collector is starting or temporarily unavailable. The shared backup feed remains available.",fetchedAt:null,intervalSeconds:2.1};}
  })();
  try{const body=await pending;memo={at:Date.now(),body};}finally{pending=null;}
 }
 const response=Response.json(memo!.body,{headers});try{await cache?.put(key,response.clone());}catch{}return response;
}
