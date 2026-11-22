import {fetchWithoutRedirect} from "../lib/edge-fetch.mjs";

export async function pollSharedAircraft(env){
  const destination=new URL("/api/collector/aircraft",env.SITE_URL);
  if(destination.protocol!=="https:")throw Error("HTTPS required for the shared aircraft collector.");
  const headers={"Content-Type":"application/json",Authorization:`Bearer ${env.VESSEL_INGEST_TOKEN}`};
  if(env.SITE_SERVICE_TOKEN)headers["OAI-Sites-Authorization"]=`Bearer ${env.SITE_SERVICE_TOKEN}`;
  async function site(body){
    const response=await fetchWithoutRedirect(destination,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw Error(`Website aircraft connection returned HTTP ${response.status}.`);
    return response.json();
  }
  const lease=await site({action:"lease"});
  if(!lease.acquired)return {state:"waiting",nextPollAt:lease.nextPollAt,message:lease.message,requestsUsed:lease.requestsUsed,requestLimit:lease.requestLimit};
  const url=new URL(lease.url);
  if(url.origin!=="https://api.adsb.lol"||!url.pathname.startsWith("/v2/icao/"))throw Error("Unexpected aircraft provider URL.");
  let report={action:"report",pollId:lease.pollId,statusCode:502};
  try{
    const providerHeaders={"User-Agent":"Logic-Emergency-Air-Sea/2.0"};
    if(lease.apiKey)providerHeaders["x-api-key"]=lease.apiKey;
    const response=await fetchWithoutRedirect(url,{headers:providerHeaders,signal:AbortSignal.timeout(20_000)});
    report={...report,statusCode:response.status,retryAfter:response.headers.get("Retry-After")||""};
    if(response.ok){const text=await response.text();if(text.length>1_400_000)throw Error("Aircraft response too large.");report.payload=JSON.parse(text);}
  }catch{report={action:"report",pollId:lease.pollId,statusCode:502};}
  const result=await site(report);
  return {state:result.accepted?"receiving":"paused",positions:result.positions||0,nextPollAt:result.nextPollAt||Date.now()+lease.intervalMs,lastPollAt:Date.now(),statusCode:report.statusCode};
}
