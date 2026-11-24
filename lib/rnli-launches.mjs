import {stableIncidentId,plainText} from "./incident-core.mjs";
import {inRegion} from "./tracking-core.mjs";

export function normalizeRnli(data,source,now=Date.now()){
 if(!data||data.SolrFailed!==false||!Array.isArray(data.Results)||data.Results.length>500)throw Error("Invalid RNLI launch data");
 const events=new Map();let latestSourceAt=null;
 for(const row of data.Results){
  if(!row||typeof row.Title!=="string"||typeof row.Url!=="string"||typeof row.Date!=="string")continue;
  const match=/^\/Date\((\d{1,16})(?:[+-]\d{4})?\)\/$/.exec(row.Date);
  const at=match?Number(match[1]):NaN;
  if(!Number.isSafeInteger(at)||at<=0||at>now+60000)continue;
  latestSourceAt=Math.max(latestSourceAt||0,at);
  if(now-at>=86400000)continue;
  const title=plainText(row.Title,160);
  if(!title||!/^\/find-my-nearest\/lifeboat-stations\/[a-z0-9-]+\/?$/i.test(row.Url))continue;
  const path=row.Url.toLowerCase().replace(/\/$/,"");
  const lat=row.Location?.Latitude,lon=row.Location?.Longitude;
  const located=typeof lat==="number"&&typeof lon==="number"&&inRegion(lat,lon);
  const id="rnli:"+stableIncidentId(path+"|"+at);
  events.set(id,{id,kind:"incident",title:title+" — reported launch",summary:"RNLI published a lifeboat launch. The station location does not identify the rescue location, vessel position or current tasking.",sourceId:source.id,sourceName:source.name,sourceUrl:"https://rnli.org"+path,relatedLinks:[source.home],attribution:source.attribution,licenceUrl:source.licenceUrl,confidence:"reported",category:"Lifeboat",eventType:"lifeboat-launch",eventAt:at,timeBasis:"source",firstSeenAt:now,lastSeenAt:now,lat:located?lat:null,lon:located?lon:null,locationBasis:located?"station coordinates":"unlocated"});
 }
 return {events:[...events.values()],latestSourceAt,receivedItems:data.Results.length};
}

export async function parseRnliPage(html,source,now=Date.now()){
 if(typeof html!=="string"||html.length>2097152)throw Error("Invalid RNLI HTML");
 let raw=null,count=0;
 const response=new HTMLRewriter().on("[data-rnli-map-data]",{element(el){count++;raw=el.getAttribute("data-json");}}).transform(new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8"}}));
 await response.text();
 if(count!==1||!raw||raw.length>524288)throw Error("Missing or ambiguous RNLI map data");
 return normalizeRnli(JSON.parse(raw),source,now);
}
