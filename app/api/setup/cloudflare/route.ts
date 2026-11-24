import {parseJsonObject} from "../../../../lib/json-input";
import type {CollectorConfig,CollectorStatus} from "../../../../lib/tracking-types";
type CloudflareBinding={name?:string;text?:string;class_name?:string};
type CloudflarePayload<T>={success?:boolean;errors?:{code?:number}[];result?:T};
import { getChatGPTUser } from "../../../chatgpt-auth";
import {ownerAllowed,setupRequestAllowed} from "../../../../lib/site-security.mjs";
import { runtimeEnv } from "../../../../lib/live-store";
import { COLLECTOR_NAME, SITE_ORIGIN, CF_API, verifyFreeAccount, collectorOrigin, validCollectorOrigin, uploadMetadata } from "../../../../lib/cloudflare-setup.mjs";
import bundle from "../../../../data/collector-bundle.json";
import { fetchWithoutRedirect } from "../../../../lib/edge-fetch.mjs";
export const dynamic="force-dynamic";
const noCache={"Cache-Control":"no-store, private","Referrer-Policy":"no-referrer"};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:noCache});
const config=()=>runtimeEnv() as ReturnType<typeof runtimeEnv> & {COLLECTOR_OWNER_EMAIL?:string;SITE_SERVICE_TOKEN?:string};

async function authorized() {
  const user=await getChatGPTUser(), owner=config().COLLECTOR_OWNER_EMAIL;
  return ownerAllowed(user,owner);
}
async function savedConfig() {
  const db=config().DB;
  if(!db)throw new Error("Shared collector storage is unavailable.");
  const row=await db.prepare("SELECT snapshot FROM feed_state WHERE id='collector-config'").first<{snapshot:string}>();
  if(!row)return null;
  try{const value:CollectorConfig=JSON.parse(row.snapshot);return validCollectorOrigin(value.url)?value:null;}catch{return null;}
}
export async function GET() {
  if(!await authorized())return json({error:"Sign in with the website owner’s ChatGPT account to manage this connection."},403);
  const setup=await savedConfig();
  return json({ready:Boolean(config().VESSEL_INGEST_TOKEN&&config().SITE_SERVICE_TOKEN),collector:setup,trackedMmsis:bundle.mmsis});
}
export async function POST(request:Request) {
  if(!await authorized())return json({error:"Only the signed-in website owner can change this connection."},403);
  if(!setupRequestAllowed(request))return json({error:"Open the connection page on this website and try again."},403);
  if(Number(request.headers.get("Content-Length")||0)>5000)return json({error:"Request is too large."},413);
  const text=await request.text();if(text.length>5000)return json({error:"Request is too large."},413);
  let body;try{body=parseJsonObject(text);}catch{return json({error:"Invalid connection details."},400);}
  if(!body||typeof body.action!=="string"||!["deploy","start","stop","status"].includes(body.action))return json({error:"Unknown action."},400);
  const env=config();
  const db=env.DB;
  if(!db)return json({error:"Shared collector storage is unavailable."},503);
  if(!env.VESSEL_INGEST_TOKEN||!env.SITE_SERVICE_TOKEN)return json({error:"The website’s private collector connection is not configured yet."},503);
  // One shared setup lease also makes double-clicks and concurrent tabs safe.
  await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES('collector-setup-lock','{}') ON CONFLICT(id) DO NOTHING").run();
  const now=Date.now();
  const lock=await db.prepare("UPDATE feed_state SET next_poll_at=? WHERE id='collector-setup-lock' AND next_poll_at<=? RETURNING id").bind(now+90_000,now).first();
  if(!lock)return json({error:"Another connection request is in progress. Wait a moment and retry."},409);
  try {
    let setup=await savedConfig();
    if(body.action==="deploy") {
      const {accountId,cloudflareToken,aisKey}=body;
      if(typeof accountId!=="string"||typeof cloudflareToken!=="string"||!/^[a-f0-9]{32}$/i.test(accountId)||!/^[A-Za-z0-9_-]{30,256}$/.test(cloudflareToken)||typeof aisKey!=="string"||aisKey.length>256||/\s/.test(aisKey)||aisKey&&aisKey.length<8||!setup&&aisKey.length<8)
        return json({error:"Check the account ID and both keys. Paste only the values, without surrounding spaces."},400);
      if(body.freeConfirmed!==true)return json({error:"Confirm that this is a Cloudflare Workers Free account."},400);
      if(setup?.accountId&&setup.accountId!==accountId)throw new Error("A collector is already configured in another Cloudflare account. Keep using that account so a second collector is not created.");
      const accountPath=`/accounts/${accountId}`;
      const cf=async<T=unknown>(path:string,init:RequestInit={},missingOk=false)=>{
        const response=await fetchWithoutRedirect(CF_API+accountPath+path,{...init,headers:{Authorization:`Bearer ${cloudflareToken}`,...init.headers},signal:AbortSignal.timeout(20_000)});
        if(missingOk&&response.status===404)return null;
        const payload:CloudflarePayload<T>=await response.json();
        if(!response.ok||payload.success!==true){
          const code=Number(payload.errors?.[0]?.code);
          throw new Error(`Cloudflare refused ${init.method||"GET"} ${path} (HTTP ${response.status}${Number.isFinite(code)?`, code ${code}`:""}). Check the token permissions. No paid upgrade is attempted.`);
        }
        return payload;
      };
      // All checks precede the first Cloudflare write. Tokens stay in memory.
      verifyFreeAccount(await cf("/subscriptions"));
      const domain=await cf<{subdomain?:string}>("/workers/subdomain");
      const target=collectorOrigin(domain?.result?.subdomain);
      const existing=await cf<{bindings?:CloudflareBinding[]}>(`/workers/scripts/${COLLECTOR_NAME}/settings`,{},true);
      if(!existing&&!aisKey)throw new Error("A first deployment needs your AISStream key.");
      if(existing && (!existing.result?.bindings?.some(b=>b.name==="SITE_URL"&&b.text===SITE_ORIGIN)||!existing.result?.bindings?.some(b=>b.name==="AIS_COLLECTOR"&&b.class_name==="RescueAIS")))
        throw new Error("A different Worker already uses this collector name. It has been left unchanged.");
      const metadata=uploadMetadata({aisKey,ingestToken:env.VESSEL_INGEST_TOKEN,siteToken:env.SITE_SERVICE_TOKEN,existing:Boolean(existing)});
      const form=new FormData();
      form.set("metadata",new Blob([JSON.stringify(metadata)],{type:"application/json"}));
      form.set("collector.mjs",new Blob([bundle.source],{type:"application/javascript+module"}),"collector.mjs");
      await cf(`/workers/scripts/${COLLECTOR_NAME}`,{method:"PUT",body:form});
      // Persist the non-secret endpoint immediately so a partial deploy resumes.
      setup={url:target,accountId,planCheckedAt:Date.now(),collectorVersion:2};
      await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES('collector-config',?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot").bind(JSON.stringify(setup)).run();
      await cf(`/workers/scripts/${COLLECTOR_NAME}/subdomain`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:true,previews_enabled:false})});
    }
    if(!setup)return json({error:"Deploy the collector first."},400);
    const action=body.action==="deploy"?"start":body.action;
    try {
      const response=await fetchWithoutRedirect(`${setup.url}/${action}`,{method:action==="status"?"GET":"POST",headers:{Authorization:`Bearer ${env.VESSEL_INGEST_TOKEN}`},signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw Error("Collector endpoint is not ready.");
      const status:CollectorStatus=await response.json();
      return json({ok:true,collector:setup,status:{version:status.version,active:status.active,status:status.status,connections:status.connections,subscriptionsAccepted:status.subscriptionsAccepted,compressedConnections:status.compressedConnections,decodedMessages:status.decodedMessages,decodeErrors:status.decodeErrors,binaryMessages:status.binaryMessages,lastMessageAt:status.lastMessageAt,aircraft:status.aircraft,vessels:status.vessels,messagesToday:status.messagesToday,lastPublishedAt:status.lastPublishedAt,error:status.error},message:action==="start"?"The shared aircraft and boat collector started. Positions appear as real reports arrive.":action==="stop"?"Collector stopped.":"Collector status refreshed."});
    } catch {
      return json({ok:false,collector:setup,message:"The collector is deployed but has not answered yet. Wait 30 seconds, then press Start collector. Your keys do not need to be entered again."},202);
    }
  } catch(error) {
    return json({error:error instanceof Error?error.message:"The connection could not be completed. Your keys have not been written to the website."},400);
  } finally {
    await db.prepare("UPDATE feed_state SET next_poll_at=0 WHERE id='collector-setup-lock'").run();
  }
}
