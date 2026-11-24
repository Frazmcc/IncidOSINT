// Dependency-free Node service for Render Free. The site grants one central
// permit per 30 seconds; restarts and overlapping deploys cannot double polls.
import http from "node:http";
import {gzipSync} from "node:zlib";
import {readFile} from "node:fs/promises";
import {timingSafeEqual} from "node:crypto";
import {fileURLToPath} from "node:url";
import {fetchWithoutRedirect} from "../lib/edge-fetch.mjs";
import {normalizeAircraft,retryDelay} from "../lib/tracking-core.mjs";
import {combineAircraftSnapshots} from "../lib/aircraft-fusion.mjs";
import {fastProviderUrl,compactAircraftPayload,FAST_USER_AGENT,FAST_POLL_MS,FAST_BATCH_REQUESTS} from "../lib/aircraft-fast-policy.mjs";

export function createFastCollector({siteUrl,token,fleet,fetcher=fetchWithoutRedirect,clock=Date.now,schedule=setTimeout}){
 const allowed=new Set(fleet.map(a=>a.icao_hex)),endpoint=new URL("/api/collector/adsbfi",siteUrl);
 if(endpoint.protocol!=="https:"||!token||token.length<32)throw Error("A private HTTPS aircraft connection is required");
 let snapshot={records:[],unpositioned:[]},fetchedAt=0,nextPollAt=0,lastDemand=0,busy=false,stopped=false,timer=null,status="waiting",message="Waiting for a map viewer",generation=0,backoffUntil=0,recentHistory=[];
 const wait=ms=>new Promise(resolve=>schedule(resolve,ms));
 const authorized=header=>{const a=Buffer.from(header||""),b=Buffer.from(`Bearer ${token}`);return a.length===b.length&&timingSafeEqual(a,b);};
 async function site(body){
  const response=await fetcher(endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw Error(`Aircraft coordinator returned HTTP ${response.status}`);
  return response.json();
 }
 function view(){const fields=["id","kind","identifier","name","callsign","lat","lon","observedAt","receivedAt","speed","heading","altitude","onGround","squawk","squawkObservedAt","typeCode","timeBasis"];return {...snapshot,records:snapshot.records.map(r=>Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]))),fetchedAt:fetchedAt||null,nextPollAt:nextPollAt||null,status,message,intervalSeconds:FAST_POLL_MS/1000,generation};}
 async function cycle(){
  if(busy||stopped||clock()-lastDemand>60_000)return;
  busy=true;
  try{
   if(clock()<Math.max(nextPollAt,backoffUntil))return;
   const lease=await site({action:"lease"});
   if(!lease.acquired){nextPollAt=Math.max(clock()+1000,lease.nextPollAt||clock()+30_000);return;}
   const url=fastProviderUrl(lease.url),maximum=Math.min(FAST_BATCH_REQUESTS,lease.maximumRequests),spacing=Math.max(FAST_POLL_MS,lease.intervalMs);
   // Validate every permit. No key, website token, or client header goes upstream.
   if(!Number.isInteger(maximum)||maximum<1||!Number.isFinite(lease.expiresAt)||lease.expiresAt>clock()+35_000||!Number.isFinite(spacing))throw Error("Invalid aircraft permit");
   let requestCount=0,payload=null,statusCode=200,retryAfter="",lastStarted=0;
   for(let i=0;i<maximum&&!stopped&&clock()-lastDemand<=60_000;i++){
    const delay=Math.max(0,lastStarted+spacing-clock());if(delay)await wait(delay);
    if(clock()+1000>=lease.expiresAt)break;
    lastStarted=clock();requestCount++;
    try{
     const response=await fetcher(url,{headers:{"User-Agent":FAST_USER_AGENT,Accept:"application/json"},signal:AbortSignal.timeout(8_000)});
     statusCode=response.status;retryAfter=response.headers.get("Retry-After")||"";
     if(!response.ok){backoffUntil=clock()+retryDelay(response,clock());await response.body?.cancel();break;}
     const text=await response.text();if(text.length>250_000)throw Error("Aircraft response too large");
     payload=compactAircraftPayload(JSON.parse(text),allowed);
     const received=normalizeAircraft(payload,fleet,clock());received.records=received.records.map(a=>({...a,feedProvider:"adsb.fi"}));
     snapshot=combineAircraftSnapshots([snapshot,received],clock(),fleet);
     const keepFields=["id","kind","identifier","name","lat","lon","observedAt","onGround"];
     const accepted=received.records.filter(r=>snapshot.records.some(s=>s.id===r.id&&s.observedAt===r.observedAt&&s.lat===r.lat&&s.lon===r.lon));
     recentHistory=[...recentHistory,...accepted.map(r=>Object.fromEntries(keepFields.map(k=>[k,r[k]])))].filter(r=>clock()-r.observedAt<120_000).slice(-2500);
     fetchedAt=clock();status="receiving";message="";nextPollAt=clock()+spacing;generation++;
    }catch{statusCode=502;break;}
   }
   if(payload||statusCode!==200){
    const reported=await site({action:"report",pollId:lease.pollId,requestCount,statusCode,retryAfter,payload,history:recentHistory});
    nextPollAt=Math.max(reported.nextPollAt||lease.expiresAt,backoffUntil);
    if(!reported.accepted){status="paused";message=`adsb.fi returned HTTP ${statusCode}; collection is paused.`;console.info("Aircraft source paused",statusCode);}
   }else nextPollAt=lease.expiresAt;
  }catch{status="waiting";message="The shared aircraft collector is reconnecting.";nextPollAt=Math.max(clock()+30_000,backoffUntil);}
  finally{
   busy=false;
   if(!stopped&&clock()-lastDemand<=60_000)timer=schedule(()=>{timer=null;void cycle();},Math.max(250,nextPollAt-clock()));
  }
 }
 return {authorized,view,demand(){lastDemand=clock();if(!timer&&!busy&&!stopped)void cycle();},stop(){stopped=true;if(timer)clearTimeout(timer);}};
}

export async function startFastCollector(env=process.env){
 const fleet=JSON.parse(await readFile(new URL("../data/aircraft.json",import.meta.url),"utf8"));
 const collector=createFastCollector({siteUrl:env.SITE_URL,token:env.ADSB_FI_COLLECTOR_TOKEN,fleet});
 const server=http.createServer((req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(req.method!=="GET"){res.writeHead(405);return res.end();}
  if(path==="/"||path==="/healthz"){res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});return res.end(JSON.stringify({ok:true,service:"IncidOSINT shared aircraft collector",status:collector.view().status,fetchedAt:collector.view().fetchedAt}));}
  if(path!=="/snapshot"){res.writeHead(404);return res.end();}
  if(!collector.authorized(req.headers.authorization)){res.writeHead(401);return res.end();}
  collector.demand();const body=JSON.stringify(collector.view()),compressed=String(req.headers["accept-encoding"]||"").includes("gzip");res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...(compressed?{"Content-Encoding":"gzip"}:{}),"Vary":"Accept-Encoding"});res.end(compressed?gzipSync(body):body);
 });
 server.listen(Number(env.PORT)||10000,"0.0.0.0",()=>console.info("Shared aircraft collector is ready"));
 const stop=()=>{collector.stop();server.close();};process.once("SIGTERM",stop);process.once("SIGINT",stop);return {server,collector};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await startFastCollector();
