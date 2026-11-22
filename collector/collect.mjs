import WebSocket from "ws";
import { readFile } from "node:fs/promises";
import { decodePosition, subscription } from "./ais-codec.mjs";

const key = process.env.AISSTREAM_API_KEY;
const token = process.env.VESSEL_INGEST_TOKEN;
const origin = process.env.SITE_URL;
if (!key || !token || token.length < 32 || !origin) throw Error("Set AISSTREAM_API_KEY, VESSEL_INGEST_TOKEN (32+ characters), and SITE_URL. Secrets are never logged.");
const destination = new URL("/api/ingest/vessels", origin);
if (destination.protocol !== "https:" && destination.hostname !== "127.0.0.1" && destination.hostname !== "localhost") throw Error("Use an HTTPS website URL.");
const fleet = JSON.parse(await readFile(new URL("../data/vessels.json", import.meta.url), "utf8"));
const mmsis = [...new Set(fleet.records.filter(r => r.mmsi && !r.identity_conflict).map(r => r.mmsi))];
if (mmsis.length > 600) throw Error("This filtered configuration supports at most 600 vessels across three subscriptions.");
const allowed = new Set(mmsis), latest = new Map(), sockets = new Set();
let stopping = false, pushing = false, windowStart = Date.now(), messages = 0, timer;
const MAX_MESSAGES = 1_000_000;
function stop(reason) { stopping=true;clearInterval(timer);for(const s of sockets)s.close();console.error(reason); }

function connect(chunk, attempt = 0) {
  if (stopping) return;
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream",{perMessageDeflate:true});
  sockets.add(ws);
  ws.on("open",()=>ws.send(JSON.stringify(subscription(key,chunk))));
  ws.on("message",raw=>{
    if(Date.now()-windowStart >= 86_400_000){windowStart=Date.now();messages=0;}
    if(++messages>MAX_MESSAGES){stop("Daily collector safety cap reached. Restart after the next allowance window.");return;}
    let event;try{event=JSON.parse(raw.toString());}catch{return;}
    if(event.error||event.Error||event.MessageType==="Error"){stop("AISStream rejected the subscription. Collector stopped; check the account, key and documented limits.");return;}
    if(event.MessageType==="SubscriptionConfirmation")console.log("AIS subscription confirmed; compression:",Boolean(event.Message?.CompressionEnabled ?? event.SubscriptionConfirmation?.CompressionEnabled));
    const p=decodePosition(event,allowed);if(p){const old=latest.get(p.mmsi);if(!old||p.observedAt>=old.observedAt)latest.set(p.mmsi,p);}
  });
  ws.on("error",()=>{});
  ws.on("unexpected-response",(_request,response)=>{if(response.statusCode===401||response.statusCode===403)stop("AIS authentication was rejected. Collector stopped.");ws.terminate();});
  ws.on("close",()=>{sockets.delete(ws);if(!stopping)setTimeout(()=>connect(chunk,Math.min(attempt+1,5)),Math.min(60_000,5_000*2**attempt)+Math.floor(Math.random()*2000));});
}
async function push() {
  if(pushing)return;pushing=true;
  try {
    const now=Date.now();for(const [id,p] of latest)if(now-p.observedAt>900_000)latest.delete(id);
    const headers={"Content-Type":"application/json",Authorization:`Bearer ${token}`};
    if(process.env.SITE_SERVICE_TOKEN)headers["OAI-Sites-Authorization"]=`Bearer ${process.env.SITE_SERVICE_TOKEN}`;
    const response=await fetch(destination,{method:"POST",headers,body:JSON.stringify({positions:[...latest.values()]}),signal:AbortSignal.timeout(10_000)});
    if(response.status===401||response.status===403){stop("Website authentication failed; collector stopped. Check configured secrets and private-site service access.");}
    else if(!response.ok)console.error(`Snapshot not accepted (HTTP ${response.status}); retained locally for the next cycle.`);
    else console.log(`Snapshot: ${latest.size} recent vessel positions.`);
  } catch {console.error("Website unavailable; keeping latest received positions for the next cycle.");}
  finally{pushing=false;}
}
for(let i=0;i<mmsis.length;i+=200)connect(mmsis.slice(i,i+200));
console.log(`One shared collector started for ${mmsis.length} MMSIs. No per-visitor AIS connections.`);
timer=setInterval(push,30_000);
process.on("SIGINT",()=>{stopping=true;clearInterval(timer);for(const s of sockets)s.close();setTimeout(()=>process.exit(0),500);});
