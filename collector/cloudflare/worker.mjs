import {DurableObject} from "cloudflare:workers";
import {decodePosition,decodeStreamMessage,subscription} from "../ais-codec.mjs";
import {pollSharedAircraft} from "../aircraft-poll.mjs";
import ids from "./mmsis.json";
import {fetchWithoutRedirect} from "../../lib/edge-fetch.mjs";
const idSet=new Set(ids);
export default {async fetch(request,env){
 if(!env.VESSEL_INGEST_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.VESSEL_INGEST_TOKEN}`)return new Response("Unauthorized",{status:401});
 return env.AIS_COLLECTOR.get(env.AIS_COLLECTOR.idFromName("uk-ireland-shared-rescue-ais")).fetch(request);
}};
export class RescueAIS extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);this.ctx=ctx;this.env=env;this.positions=new Map();this.channels=new Map();this.retry=new Map();this.failures=new Map();this.confirmations=new Map();this.active=false;this.aisRejected=false;this.error=null;this.lastPublishedAt=null;this.day=new Date().toISOString().slice(0,10);this.messages=0;
  this.metrics={decodedMessages:0,binaryMessages:0,decodeErrors:0,lastMessageAt:null,lastPositionAt:null,aircraft:{state:"waiting"}};
  ctx.blockConcurrencyWhile(async()=>{
   ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS snapshot(id INTEGER PRIMARY KEY,payload TEXT NOT NULL,day TEXT NOT NULL,messages INTEGER NOT NULL)");
   ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS collector_meta(id INTEGER PRIMARY KEY,active INTEGER NOT NULL,error TEXT,last_published_at INTEGER)");
   ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS collector_metrics(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)");
   const meta=ctx.storage.sql.exec("SELECT * FROM collector_meta WHERE id=1").toArray()[0];
   if(meta){this.active=Boolean(meta.active);this.error=meta.error;this.lastPublishedAt=meta.last_published_at;}
   const row=ctx.storage.sql.exec("SELECT * FROM snapshot WHERE id=1").toArray()[0];
   if(row){for(const p of JSON.parse(row.payload))this.positions.set(p.mmsi,p);if(row.day===this.day)this.messages=row.messages;}
   const metrics=ctx.storage.sql.exec("SELECT payload FROM collector_metrics WHERE id=1").toArray()[0];
   if(metrics)try{this.metrics={...this.metrics,...JSON.parse(metrics.payload)};}catch{}
  });
 }
 status(){return {version:2,active:this.active,connections:[...this.channels.values()].filter(ws=>ws.readyState===1).length,subscriptionsAccepted:this.confirmations.size,compressedConnections:[...this.confirmations.values()].filter(Boolean).length,vessels:this.positions.size,messagesToday:this.messages,maximumMessages:1_000_000,day:this.day,lastPublishedAt:this.lastPublishedAt,error:this.error,...this.metrics};}
 persistStatus(){
  this.ctx.storage.sql.exec("INSERT INTO collector_meta(id,active,error,last_published_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,error=excluded.error,last_published_at=excluded.last_published_at",this.active?1:0,this.error,this.lastPublishedAt);
  this.ctx.storage.sql.exec("INSERT INTO collector_metrics(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",JSON.stringify(this.metrics));
 }
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(!["/start","/stop","/status"].includes(path))return new Response("Not found",{status:404});
  if(path==="/status"&&request.method!=="GET"||path!=="/status"&&request.method!=="POST")return new Response("Method not allowed",{status:405});
  if(path==="/stop"){this.active=false;this.close();this.persistStatus();await this.ctx.storage.deleteAlarm();return Response.json({...this.status(),status:"stopped"});}
  if(path==="/start"){
   if(ids.length>600)return new Response("More than three filtered subscriptions would be required.",{status:409});
   this.active=true;this.aisRejected=false;this.error=null;this.retry.clear();this.persistStatus();this.connect();await this.ctx.storage.setAlarm(Date.now()+1000);return Response.json({...this.status(),status:"started",mmsis:ids.length,objects:1});
  }
  return Response.json(this.status());
 }
 close(){for(const ws of this.channels.values())try{ws.close();}catch{}this.channels.clear();this.confirmations.clear();}
 connect(){
  if(!this.active||this.aisRejected||this.messages>=1_000_000||!this.env.AISSTREAM_API_KEY)return;
  for(let i=0;i<ids.length;i+=200){
   if(this.channels.has(i)||(this.retry.get(i)||0)>Date.now())continue;
   // Workers negotiates compression. AISStream sends binary UTF-8 JSON;
   // explicitly request ArrayBuffer and also support Blob in the decoder.
   const ws=new WebSocket("wss://stream.aisstream.io/v0/stream");ws.binaryType="arraybuffer";this.channels.set(i,ws);
   const disconnected=()=>{
    if(this.channels.get(i)!==ws)return;
    this.channels.delete(i);this.confirmations.delete(i);
    const failures=Math.min((this.failures.get(i)||0)+1,6);this.failures.set(i,failures);
    this.retry.set(i,Date.now()+Math.min(300_000,5000*2**failures)+Math.floor(Math.random()*2000));try{ws.close();}catch{}
   };
   ws.addEventListener("open",()=>ws.send(JSON.stringify(subscription(this.env.AISSTREAM_API_KEY,ids.slice(i,i+200)))));
   ws.addEventListener("message",async event=>{
    if(++this.messages>1_000_000){this.close();return;}
    this.metrics.lastMessageAt=Date.now();if(typeof event.data!=="string")this.metrics.binaryMessages++;
    let message;try{message=await decodeStreamMessage(event.data);this.metrics.decodedMessages++;}catch{this.metrics.decodeErrors++;return;}
    if(message.MessageType==="SubscriptionConfirmation"){this.confirmations.set(i,Boolean(message.Message?.CompressionEnabled));this.failures.set(i,0);this.error=null;return;}
    if(message.error||message.Error||message.MessageType==="Error"){
     const detail=String(message.error||message.Error||"");
     if(/invalid.*key|key.*invalid|unauthori|authentication/i.test(detail)){this.aisRejected=true;this.error="AISStream refused the API key. Update it in private setup.";this.close();}
     else{this.error="AISStream rejected a subscription. Reconnecting with backoff; check the account connection limit.";disconnected();}
     this.persistStatus();return;
    }
    const p=decodePosition(message,idSet);if(p){const old=this.positions.get(p.mmsi);if(!old||p.observedAt>old.observedAt)this.positions.set(p.mmsi,p);this.metrics.lastPositionAt=Date.now();}
   });
   ws.addEventListener("close",disconnected);ws.addEventListener("error",disconnected);
  }
 }
 async alarm(){
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10);if(day!==this.day){this.day=day;this.messages=0;}
  for(const [id,p] of this.positions)if(now-p.observedAt>900_000)this.positions.delete(id);
  this.ctx.storage.sql.exec("INSERT INTO snapshot(id,payload,day,messages) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,day=excluded.day,messages=excluded.messages",JSON.stringify([...this.positions.values()]),this.day,this.messages);
  if(!this.active){await this.ctx.storage.deleteAlarm();return;}
  if(this.messages>=1_000_000)this.close();else this.connect();
  try{
   const url=new URL("/api/ingest/vessels",this.env.SITE_URL);if(url.protocol!=="https:")throw Error("HTTPS required");
   const headers={"Content-Type":"application/json",Authorization:`Bearer ${this.env.VESSEL_INGEST_TOKEN}`};
   if(this.env.SITE_SERVICE_TOKEN)headers["OAI-Sites-Authorization"]=`Bearer ${this.env.SITE_SERVICE_TOKEN}`;
   const response=await fetchWithoutRedirect(url,{method:"POST",headers,body:JSON.stringify({positions:[...this.positions.values()]}),signal:AbortSignal.timeout(10_000)});
   if(response.status===401||response.status===403){this.active=false;this.error="The website refused the collector connection. Reconnect from private setup.";this.close();this.persistStatus();await this.ctx.storage.deleteAlarm();return;}
   if(response.ok)this.lastPublishedAt=Date.now();
  }catch{ /* Original observation times survive any publishing outage. */ }
  try{this.metrics.aircraft={...this.metrics.aircraft,...await pollSharedAircraft(this.env),error:null};}
  catch{this.metrics.aircraft={...this.metrics.aircraft,error:"The shared aircraft collection cycle could not finish. It will retry."};}
  this.persistStatus();await this.ctx.storage.setAlarm(Date.now()+30_000);
 }
}
