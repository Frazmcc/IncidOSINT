import {runtimeEnv} from "../../../../lib/live-store";
import {validCollectorOrigin} from "../../../../lib/cloudflare-setup.mjs";
import {fetchWithoutRedirect} from "../../../../lib/edge-fetch.mjs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const env=runtimeEnv();
 if(!env.VESSEL_INGEST_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.VESSEL_INGEST_TOKEN}`)return Response.json({error:"Unauthorized"},{status:401});
 const row=await env.DB?.prepare("SELECT snapshot FROM feed_state WHERE id='collector-config'").first<{snapshot:string}>();
 let url;try{url=JSON.parse(row?.snapshot||"{}").url;}catch{}
 if(!validCollectorOrigin(url))return Response.json({error:"Collector not configured"},{status:404});
 try{const response=await fetchWithoutRedirect(url+"/status",{headers:{Authorization:`Bearer ${env.VESSEL_INGEST_TOKEN}`},signal:AbortSignal.timeout(15_000)});if(!response.ok)return Response.json({error:"Collector status unavailable",status:response.status},{status:502});return Response.json(await response.json(),{headers:{"Cache-Control":"no-store, private"}});}
 catch{return Response.json({error:"Collector status unavailable"},{status:502});}
}
