import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {advanceTrail,advanceTrailBatch,selectedTrail,trailSegments,TRAIL_SAMPLE_LIMIT,TRAIL_RETENTION_MS,RESERVE_TRAIL_BUDGET_SQL} from "../lib/flight-trails.mjs";
import {mergeAircraftSnapshots,normalizeAircraft} from "../lib/tracking-core.mjs";
const start=1_800_000_000_000;
const record=(at,onGround,lat=55.8,lon=-4.2)=>({kind:"aircraft",identifier:"4077c7",id:"air-4077c7",name:"TEST",observedAt:start+at,onGround,lat,lon});
const step=(state,at,ground,lat,lon)=>advanceTrail(state,record(at,ground,lat,lon),start+at);

test("temporary position dropouts retain original observation times while new police positions appear",()=>{
 const old=record(0,false);
 const cop={...record(60_000,false,51.8,-.31),identifier:"404a2e",id:"air-404a2e",name:"G-POLD"};
 let value=mergeAircraftSnapshots({records:[cop],rejected:[]},{records:[old]},start+180_000);
 assert.equal(value.records.length,2);assert.equal(value.records.find(r=>r.id===old.id).observedAt,start);
 assert.equal(mergeAircraftSnapshots({records:[],rejected:[]},value,start+900_001).records.some(r=>r.id===old.id),false);
 assert.equal(mergeAircraftSnapshots({records:[],rejected:[{hex:"4077c7"}]},value,start+180_000).records.some(r=>r.id===old.id),false);
});
test("MLAT police positions are accepted; an active signal without coordinates is explained without inventing a pin",()=>{
 const fleet=[{icao_hex:"404a2e",registration:"G-POLD",category:"Police"},{icao_hex:"406343",registration:"G-NWOI",category:"Police"}];
 const result=normalizeAircraft({now:start,ac:[{hex:"404a2e",r:"G-POLD",type:"mlat",lat:51.819,lon:-.31,seen_pos:24,alt_baro:1300},{hex:"406343",r:"G-NWOI",type:"mode_s",seen:.2,alt_baro:1200}]},fleet,start);
 assert.equal(result.records[0].name,"G-POLD");assert.equal(result.records[0].onGround,false);
 assert.equal(result.unpositioned[0].name,"G-NWOI");assert.equal("lat" in result.unpositioned[0],false);
});
test("a recorded ground departure, airborne path and ground return form one completed flight",()=>{
 let state=step(null,0,true);
 assert.equal(selectedTrail(state,start),null);
 state=step(state,180_000,false,55.81,-4.19);
 assert.equal(state.active.departureObserved,true);assert.equal(state.active.points[0].ground,true);
 state=step(state,360_000,false,55.83,-4.15);
 state=step(state,540_000,true,55.8005,-4.2);
 assert.equal(state.active,null);assert.equal(state.completed.length,1);
 const flight=selectedTrail(state,start+540_000);
 assert.equal(flight.status,"returned");assert.equal(flight.points.length,4);assert.equal(flight.endedAt,start+540_000);
 state=step(state,720_000,true,55.8005,-4.2);assert.equal(state.completed[0].points.length,4);
 state=step(state,900_000,false,55.81,-4.19);assert.notEqual(state.active.id,flight.id);
});
test("flights first seen airborne are partial, and landing elsewhere is not labelled a return to base",()=>{
 let state=step(null,0,false);
 assert.equal(state.active.departureObserved,false);assert.equal(state.active.points.length,1);
 state=step(state,180_000,true,55.83,-4.1);
 assert.equal(selectedTrail(state,start+180_000).status,"landed");
 let known=step(null,0,true);known=step(known,180_000,false,55.81,-4.19);known=step(known,360_000,true,55.9,-4.1);
 assert.equal(known.completed[0].status,"landed");
});
test("reception gaps and implausible jumps are not joined; a missing signal never proves landing",()=>{
 let state=step(null,0,false);
 state=step(state,660_000,false,55.82,-4.19);
 const flight=selectedTrail(state,start+660_000);assert.equal(flight.gaps,true);assert.equal(flight.segments.length,2);
 assert.equal(selectedTrail(state,start+1_800_000).status,"airborne");assert.equal(selectedTrail(state,start+1_800_000).stale,true);
 state=step(state,2_700_000,false,56,-4.2);assert.equal(state.completed[0].status,"coverage-gap");assert.equal(state.active.departureObserved,false);
 assert.equal(trailSegments([{lat:50,lon:-4,at:start},{lat:60,lon:-4,at:start+1000}]).length,2);
});
test("duplicate, old and invalid samples cannot freshen a track; unknown ground status does not fabricate a flight",()=>{
 const state=step(null,0,false);assert.equal(step(state,0,false),null);
 assert.equal(advanceTrail(null,record(0,false),start+900_001),null);
 assert.equal(step(null,0,false,91,-4),null);
 let unknown=step(null,0,null);assert.equal(unknown.active.status,"unconfirmed");
 unknown=step(unknown,180_000,true);assert.equal(unknown.completed[0].status,"grounded");
 assert.equal(selectedTrail(state,start+TRAIL_RETENTION_MS+1),null);
});
test("track capture has an atomic daily write budget and resumes in a new allowance window",()=>{
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE trail_budget(id TEXT PRIMARY KEY,window_start INTEGER,samples INTEGER)");db.prepare("INSERT INTO trail_budget VALUES ('aircraft',?,0)").run(start);
 const reserve=db.prepare(RESERVE_TRAIL_BUDGET_SQL),take=(at,n)=>reserve.get(at-86_400_000,at,n,TRAIL_SAMPLE_LIMIT);
 for(let i=0;i<100;i++)assert.ok(take(start,80));
 assert.equal(take(start,1),undefined);assert.equal(db.prepare("SELECT samples FROM trail_budget").get().samples,8_000);
 assert.ok(take(start+86_400_000,1));assert.equal(db.prepare("SELECT samples FROM trail_budget").get().samples,1);db.close();
});

test("a cached observation and a new poll bootstrap one continuous partial trail without timestamp changes",()=>{
 const older=record(0,false),fresh=record(180_000,false,55.82,-4.19);
 const updates=advanceTrailBatch([fresh,older],new Map(),start+180_000);
 assert.equal(updates.length,1);assert.equal(updates[0].state.active.points.length,2);
 assert.deepEqual(updates[0].state.active.points.map(p=>p.at),[start,start+180_000]);
 assert.equal(updates[0].state.active.departureObserved,false);
 const saved=new Map([[older.identifier,updates[0].state]]);
 assert.equal(advanceTrailBatch([older,fresh],saved,start+180_000).length,0);
});
