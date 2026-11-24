import test from "node:test";
import assert from "node:assert/strict";
import {normalizeRnli} from "../lib/rnli-launches.mjs";
import {INCIDENT_SOURCES} from "../lib/incident-sources.mjs";
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
