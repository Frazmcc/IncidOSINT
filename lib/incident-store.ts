import {INCIDENT_SOURCES,INCIDENT_RETENTION_MS,INCIDENT_WRITE_LIMIT} from "./incident-sources.mjs";
import {detectAssetActivity,mergeIncidentEvents,parseIncidentFeed} from "./incident-core.mjs";
import {RESERVE_POLL_SQL,DAY_MS} from "./tracking-core.mjs";
import {fetchWithoutRedirect} from "./edge-fetch.mjs";

type Row={id:string;snapshot:string;fetched_at:number;next_poll_at:number;window_start:number;requests:number;blocked_until:number;last_error:string|null};
const initial="{}";
const read=(db:D1Database,id:string)=>db.prepare("SELECT * FROM feed_state WHERE id=?").bind(id).first<Row>();
async function ensure(db:D1Database,id:string){await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES(?,?) ON CONFLICT(id) DO NOTHING").bind(id,initial).run();}
function parsed(row:Row|null){try{return JSON.parse(row?.snapshot||initial);}catch{return {};}}
async function writeSlot(db:D1Database,now:number){
 await ensure(db,"incident-write-budget");
 return Boolean(await db.prepare(`UPDATE feed_state SET window_start=CASE WHEN window_start<=?1 THEN ?2 ELSE window_start END,requests=CASE WHEN window_start<=?1 THEN 1 ELSE requests+1 END WHERE id='incident-write-budget' AND (window_start<=?1 OR requests<?3) RETURNING id`).bind(now-DAY_MS,now,INCIDENT_WRITE_LIMIT).first());
}

export async function saveIncidentEvents(db:D1Database,incoming:any[],now=Date.now()){
 if(!incoming.length)return;
 await ensure(db,"incident-events");
 for(let attempt=0;attempt<4;attempt++){
  const before=await read(db,"incident-events"),events=mergeIncidentEvents(incoming,parsed(before).events||[],now),next=JSON.stringify({events});
  if(next===before?.snapshot)return;
  if(!await writeSlot(db,now))return;
  const write=await db.prepare("UPDATE feed_state SET snapshot=?,fetched_at=? WHERE id='incident-events' AND snapshot=?").bind(next,now,before?.snapshot||initial).run();
  if(write.meta.changes)return;
 }
 throw Error("Concurrent incident update; the shared collector will retry.");
}

export async function captureAssetActivity(db:D1Database,records:any[],now=Date.now()){
 if(!records.length)return;
 const kind=records[0].kind;if(!["aircraft","vessel"].includes(kind))return;
 const id=`incident-${kind}-state`;await ensure(db,id);
 for(let attempt=0;attempt<3;attempt++){
  const before=await read(db,id),prior=parsed(before).assets||{},result=detectAssetActivity(records,prior,now),next=JSON.stringify({assets:result.state});
  if(next===before?.snapshot)return;
  await saveIncidentEvents(db,result.events,now);
  if(!await writeSlot(db,now))return;
  const write=await db.prepare("UPDATE feed_state SET snapshot=?,fetched_at=? WHERE id=? AND snapshot=?").bind(next,now,id,before?.snapshot||initial).run();
  if(write.meta.changes)return;
 }
}

async function limitedText(response:Response){
 if(Number(response.headers.get("Content-Length")||0)>524288)throw Error("Incident feed exceeds its free processing limit.");
 if(!response.body)return "";
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text="";
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>524288)throw Error("Incident feed exceeds its free processing limit.");text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
 finally{await reader.cancel().catch(()=>{});}
}

// Static allowlist, public GETs, no keys or paid fallback. A durable reservation
// happens before fetching, so concurrent visitors do not multiply source calls.
export async function refreshIncidentFeeds(db:D1Database,now=Date.now()){
 if(!db)return;
 const budget=await read(db,"incident-write-budget");
 if(budget&&budget.requests>=INCIDENT_WRITE_LIMIT&&now-budget.window_start<DAY_MS)return;
 await Promise.allSettled(INCIDENT_SOURCES.filter(s=>s.enabled).map(async source=>{
  const id=`incident-source-${source.id}`;await ensure(db,id);
  const reserved=await db.prepare(RESERVE_POLL_SQL).bind(now+source.intervalMs!,now-DAY_MS,now,id,source.limit!).first();
  if(!reserved)return;
  try{
   const response=await fetchWithoutRedirect(source.url!,{headers:{Accept:"application/rss+xml, application/xml, text/xml","User-Agent":"IncidOSINT/1.0 (+https://logic-uk-ireland-rescue-vessels.starrycapybara8.chatgpt.site/)"},signal:AbortSignal.timeout(6000)});
   if(!response.ok){
    const header=response.headers.get("Retry-After"),seconds=Number(header),date=header?Date.parse(header):NaN,retry=header&&Number.isFinite(seconds)&&seconds>=0?seconds*1000:Number.isFinite(date)?Math.max(0,date-now):0;
    const until=now+(response.status===429?Math.max(3_600_000,retry):response.status===401||response.status===403?DAY_MS:source.intervalMs!);
    await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id=?").bind(until,`Source returned HTTP ${response.status}; retaining earlier reports.`,id).run();return;
   }
   const result=parseIncidentFeed(await limitedText(response),source,now);
   await saveIncidentEvents(db,result.events,now);
   const info={latestSourceAt:result.latestSourceAt,receivedItems:result.receivedItems};
   await db.prepare("UPDATE feed_state SET snapshot=?,fetched_at=?,blocked_until=0,last_error=NULL WHERE id=?").bind(JSON.stringify(info),now,id).run();
  }catch{await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id=?").bind(now+source.intervalMs!,"Source unavailable or invalid; retaining original report times.",id).run();}
 }));
}

export async function incidentSnapshot(db:D1Database,now=Date.now()){
 if(!db)throw Error("Incident storage is unavailable.");
 const rows=await db.prepare("SELECT * FROM feed_state WHERE id LIKE 'incident-%' OR id='aircraft-worker'").all<Row>();
 const map=new Map((rows.results||[]).map(r=>[r.id,r])),events=mergeIncidentEvents([],parsed(map.get("incident-events")||null).events||[],now);
 const budget=map.get("incident-write-budget"),heartbeat=map.get("aircraft-worker");
 const sources=INCIDENT_SOURCES.map(source=>{
  const row=map.get(`incident-source-${source.id}`),info=parsed(row||null),capped=Boolean(row&&row.requests>=source.limit!&&now-row.window_start<DAY_MS);
  const stale=Boolean(info.latestSourceAt&&now-info.latestSourceAt>INCIDENT_RETENTION_MS);
  return {...source,url:undefined,status:!source.enabled?source.status:row?.last_error||capped?"paused":!row?.fetched_at?"waiting":stale?"stale":"receiving",checkedAt:row?.fetched_at||null,latestSourceAt:info.latestSourceAt||null,receivedItems:info.receivedItems??null,requestsUsed:row?.requests||0,nextCheckAt:row?Math.max(row.next_poll_at,row.blocked_until,capped?row.window_start+DAY_MS:0):null,message:row?.last_error|| (stale?"The source was checked, but its latest incident item is older than 24 hours.":"")};
 });
 return {events,sources,servedAt:now,retentionHours:24,pollSeconds:30,sensitivity:"balanced",eventLimit:250,collectionMode:heartbeat&&now-heartbeat.fetched_at<180_000?"background":"on-demand",writeBudget:{used:budget?.requests||0,limit:INCIDENT_WRITE_LIMIT,paused:Boolean(budget&&budget.requests>=INCIDENT_WRITE_LIMIT&&now-budget.window_start<DAY_MS)},message:"Reported road incidents and inferred aircraft/vessel activity are separate. An activity pin is the asset position at detection, not a confirmed incident location."};
}
