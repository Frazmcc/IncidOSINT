import {XMLParser,XMLValidator} from "fast-xml-parser";
import {INCIDENT_EVENT_LIMIT,INCIDENT_RETENTION_MS} from "./incident-sources.mjs";
import {inRegion} from "./tracking-core.mjs";
import {squawkMeaning,squawkIsRecent} from "./aircraft-signals.mjs";

export function stableIncidentId(value){let a=2166136261,b=5381;for(const c of String(value).slice(0,4000)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return `${(a>>>0).toString(16)}${(b>>>0).toString(16)}`;}
const value=v=>v&&typeof v==="object"?v["#text"]??"":v??"";
const decode=s=>String(s).replace(/&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-f]{1,6});/gi,e=>{const known={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"};if(known[e.toLowerCase()])return known[e.toLowerCase()];const n=e[2]?.toLowerCase()==="x"?parseInt(e.slice(3,-1),16):parseInt(e.slice(2,-1),10);return Number.isFinite(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):"";});
export const plainText=(v,max=800)=>decode(decode(String(value(v)))).replace(/<[^>]{0,3000}>/g," ").replace(/\s+/g," ").trim().slice(0,max);
export function incidentLink(v){const s=decode(String(value(v))).trim();try{const u=new URL(s);return s.length<=2500&&["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?s:null;}catch{return null;}}
function sourceTime(v,now){const s=String(value(v)).trim();if(!s||!/(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(s))return null;const at=Date.parse(s);return Number.isFinite(at)&&at>0&&at<=now+60_000?at:null;}

export function parseIncidentFeed(xml,source,now=Date.now()){
 if(typeof xml!=="string"||xml.length>524288||/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error("Invalid or oversized incident RSS.");
 const parsed=new XMLParser({ignoreAttributes:true,processEntities:false,parseTagValue:false,trimValues:true,isArray:name=>name==="item"}).parse(xml);
 const channel=parsed?.rss?.channel;if(!channel||!channel.title)throw Error("The source did not return RSS.");
 const entries=Array.isArray(channel.item)?channel.item:[],events=[];let latestSourceAt=null;
 for(const item of entries.slice(0,120)){
  const title=plainText(item.title,200),summary=plainText(item.description,900),at=sourceTime(item.pubDate??item["dc:date"],now);
  if((item.pubDate||item["dc:date"])&&!at)continue;
  if(at&&(!latestSourceAt||at>latestSourceAt))latestSourceAt=at;
  if(!title||(/\b(?:roadworks|planned event|scheduled maintenance|marathon|sporting event)\b/i.test(title+" "+summary)&&! /\b(?:collision|crash|fire|emergency|accident)\b/i.test(title+" "+summary)))continue;
  const sourceUrl=incidentLink(item.link)||incidentLink(channel.link)||source.home;
  const point=String(item["georss:point"]||"").trim().split(/\s+/).map(Number);
  const lat=Number(item["geo:lat"]??item.latitude??(point.length===2?point[0]:NaN)),lon=Number(item["geo:long"]??item.longitude??(point.length===2?point[1]:NaN));
  const located=inRegion(lat,lon),key=String(value(item.guid)||item.link||`${title}|${located?lat+","+lon:""}`);
  const relatedLinks=[...new Set([...String(value(item.description)).matchAll(/(?:href\s*=\s*["']([^"']+)["']|\bhttps?:\/\/[^\s<>"']+)/gi)].map(m=>incidentLink(decode(m[1]||m[0]))).filter(Boolean))].slice(0,10);
  events.push({id:`${source.id}:${stableIncidentId(key)}`,kind:"incident",title,summary,sourceId:source.id,sourceName:source.name,sourceUrl,relatedLinks,attribution:source.attribution,licenceUrl:source.licenceUrl,confidence:"reported",category:"Traffic",eventType:"road-incident",eventAt:at,timeBasis:at?"source":"received",firstSeenAt:now,lastSeenAt:now,lat:located?lat:null,lon:located?lon:null,locationBasis:located?"source coordinates":"unlocated"});
 }
 return {events,latestSourceAt,receivedItems:entries.length};
}

export function mergeIncidentEvents(incoming,previous=[],now=Date.now()){
 const all=new Map();
 for(const e of [...previous,...incoming]){
  if(!e?.id||e.kind!=="incident")continue;
  const prior=all.get(e.id),firstSeenAt=prior?.firstSeenAt??e.firstSeenAt??now;
  const eventAt=e.timeBasis==="received"?prior?.eventAt??firstSeenAt:e.eventAt;
  if(!Number.isFinite(eventAt)||now-eventAt>INCIDENT_RETENTION_MS||eventAt>now+60_000)continue;
  all.set(e.id,{...prior,...e,eventAt,firstSeenAt,lastSeenAt:Math.max(prior?.lastSeenAt||0,e.lastSeenAt||0)});
 }
 return [...all.values()].sort((a,b)=>b.eventAt-a.eventAt).slice(0,INCIDENT_EVENT_LIMIT);
}

function distance(a,b){const rad=Math.PI/180,dlat=(a.lat-b.lat)*rad,dlon=(a.lon-b.lon)*rad;const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;return 12_742_000*Math.asin(Math.min(1,Math.sqrt(h)));}
export function detectAssetActivity(records,previous={},now=Date.now()){
 const state={};for(const [id,p] of Object.entries(previous))if(p&&now-p.at<=21_600_000)state[id]=p;
 const events=[];
 for(const r of records.slice(0,650)){
  if(!["aircraft","vessel"].includes(r.kind)||!inRegion(r.lat,r.lon)||!Number.isFinite(r.observedAt)||now-r.observedAt>180_000||r.observedAt>now+60_000)continue;
  const old=state[r.id],positionNew=!old||r.observedAt>old.at,signalNew=r.kind==="aircraft"&&Number.isFinite(r.squawkObservedAt)&&r.squawkObservedAt>(old?.signalAt||0);
  if(!positionNew&&!signalNew)continue;
  if(old&&r.observedAt<old.at)continue;
  const prior=old&&r.observedAt-old.at<=600_000?old:null;
  const next={at:r.observedAt,lat:r.lat,lon:r.lon,speed:r.speed,ground:r.onGround,signal:r.kind==="aircraft"&&squawkIsRecent(r,now)?squawkMeaning(r)?r.squawk:null:null,signalAt:r.squawkObservedAt||0,anchor:prior?.anchor||null,moving:prior?.moving||0};
  const event=(type,title,summary,identity=r.observedAt,eventAt=r.observedAt)=>events.push({id:`activity:${r.identifier}:${type}:${identity}`,kind:"incident",title,summary,sourceId:"asset-activity",sourceName:r.kind==="aircraft"?"ADS-B activity detection":"AIS activity detection",sourceUrl:r.sourceUrl||null,attribution:r.kind==="aircraft"?"Derived from adsb.lol aircraft observations":"Derived from AISStream vessel observations",confidence:"inferred",category:r.category,eventType:type,eventAt,timeBasis:"source",firstSeenAt:now,lastSeenAt:now,lat:r.lat,lon:r.lon,locationBasis:"asset position",assetId:r.id,assetName:r.name,assetKind:r.kind,identifier:r.identifier});
  if(r.kind==="aircraft"){
   if(positionNew&&prior?.ground===true&&r.onGround===false&&Number.isFinite(r.speed)&&r.speed>=20)event("departure",`${r.category==="Medical"?"Air ambulance":r.category} departure detected`,`${r.name}: received ground-to-air transition. Flight purpose is unconfirmed.`);
   const signalType=code=>code==="0023"?"sar":code?"police":null;
   if(next.signal&&signalType(next.signal)!==signalType(prior?.signal))event(next.signal==="0023"?"sar-squawk":"police-squawk",next.signal==="0023"?"SAR squawk received":"Police air-support squawk received",`${r.name}: reported UK squawk ${next.signal}. This does not confirm an emergency or an active incident.`,r.squawkObservedAt||r.observedAt,Math.max(r.observedAt,r.squawkObservedAt||0));
  }else if(positionNew&&Number.isFinite(r.speed)){
   if(r.speed<=1){next.anchor={lat:r.lat,lon:r.lon,at:r.observedAt};next.moving=0;}
   else if(next.anchor&&r.speed>=5&&distance(r,next.anchor)>=300){next.moving++;if(next.moving>=2){event("underway",`${r.category} vessel underway`,`${r.name}: two moving reports after a received stationary position. Tasking and incident location are unconfirmed.`,next.anchor.at);next.anchor=null;next.moving=0;}}
   else next.moving=0;
  }
  state[r.id]=next;
 }
 const bounded=Object.fromEntries(Object.entries(state).sort((a,b)=>b[1].at-a[1].at).slice(0,800));
 return {state:bounded,events};
}
