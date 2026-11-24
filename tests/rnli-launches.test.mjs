import test from "node:test";
import assert from "node:assert/strict";
import {normalizeRnli} from "../lib/rnli-launches.mjs";
import {INCIDENT_SOURCES} from "../lib/incident-sources.mjs";
import {build} from "esbuild";
import {Miniflare} from "./helpers/miniflare.mjs";
const source=INCIDENT_SOURCES.find(s=>s.id==="rnli"),now=Date.parse("2026-11-24T21:00:00Z");
const row={Title:"Oban Lifeboat Station",Url:"/find-my-nearest/lifeboat-stations/oban-lifeboat-station",Date:"/Date("+(now-60000)+")/",Location:{Latitude:56.411,Longitude:-5.479}};
const wrap=Results=>({Results,SolrFailed:false});
test("RNLI reports preserve source times and station-only coordinates",()=>{
 const result=normalizeRnli(wrap([row,row]),source,now);
 assert.equal(result.events.length,1);
 const e=result.events[0];assert.equal(e.eventAt,now-60000);assert.equal(e.locationBasis,"station coordinates");assert.equal(e.confidence,"reported");assert.equal(e.lat,56.411);
 assert.equal(normalizeRnli(wrap([row]),source,now+300000).events[0].id,e.id);
});
test("RNLI rejects invalid payloads, unsafe links and timestamps; never invents coordinates",()=>{
 assert.throws(()=>normalizeRnli({Results:[],SolrFailed:true},source,now));
 assert.throws(()=>normalizeRnli(wrap(Array(501).fill(row)),source,now));
 assert.equal(normalizeRnli(wrap([{...row,Url:"//evil.test"},{...row,Date:"invalid"},{...row,Date:"/Date("+(now+90000)+")/"},{...row,Date:"/Date("+(now-86400000)+")/"}]),source,now).events.length,0);
 assert.equal(normalizeRnli(wrap([{...row,Location:{Latitude:91,Longitude:0}}]),source,now).events[0].lat,null);
 assert.equal(normalizeRnli(wrap([]),source,now).events.length,0);
});

test("the real Workers HTML parser accepts RNLI's entity-encoded map attribute and rejects ambiguous data",async()=>{
 const compiled=await build({stdin:{contents:`import {parseRnliPage} from './lib/rnli-launches.mjs';import {INCIDENT_SOURCES} from './lib/incident-sources.mjs';export default{async fetch(request){try{return Response.json(await parseRnliPage(await request.text(),INCIDENT_SOURCES.find(s=>s.id==='rnli'),${now}));}catch{return Response.json({error:'Invalid source data'},{status:400});}}};`,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],external:["cloudflare:workers"],write:false});
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",outboundService:()=>{throw Error("Parsing must not fetch another source");}});
 const fixture={...row,Title:'Oban "Port" & Harbour Lifeboat Station'};
 const payload=JSON.stringify(wrap([fixture,fixture]));
 const encoded=payload.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
 const page=value=>`<div data-rnli-map-data data-json="${value}"></div>`;
 try{
  for(const attribute of [encoded,encoded.replace(/&quot;/g,"&#34;"),encoded.replace(/&quot;/g,"&#x22;")]){
   const response=await mf.dispatchFetch("https://source.test/",{method:"POST",body:page(attribute)});
   assert.equal(response.status,200);const value=await response.json();
   assert.equal(value.events.length,1);assert.equal(value.events[0].eventAt,now-60000);
   assert.equal(value.events[0].title,fixture.Title+" — reported launch");
   assert.equal(value.events[0].locationBasis,"station coordinates");assert.equal(value.events[0].lat,row.Location.Latitude);
  }
  for(const body of [page(encoded)+page(encoded),page("&quot;invalid&quot;"),page("&#0;")]){
   assert.equal((await mf.dispatchFetch("https://source.test/",{method:"POST",body})).status,400);
  }
 }finally{await mf.dispose();}
});
