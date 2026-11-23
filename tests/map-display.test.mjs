import test from "node:test";
import assert from "node:assert/strict";
import {ACTIVITY_MARKER_MAX_AGE_MS,incidentMarkerVisible} from "../lib/map-display.mjs";
import {aircraftPositionVisible,mergeAircraftSnapshots,normalizeAircraft,DAY_MS} from "../lib/tracking-core.mjs";
import {aircraftLightPattern} from "../lib/aircraft-signals.mjs";
import {mergeIncidentEvents} from "../lib/incident-core.mjs";

const now=1_800_000_000_000;
const fleet=[{icao_hex:"4077c7",registration:"G-GSAS",category:"Air ambulance / HEMS",territory:"United Kingdom"}];
const ground={id:"air-4077c7",identifier:"4077c7",name:"G-GSAS",kind:"aircraft",category:"Medical",onGround:true,lat:55.8,lon:-4.2,observedAt:now-DAY_MS,receivedAt:now-DAY_MS};
const event={id:"activity:test",kind:"incident",confidence:"inferred",eventAt:now,firstSeenAt:now,lat:55.8,lon:-4.2};

test("detected activity expires at 30 minutes without losing its 24-hour report or resetting on refresh",()=>{
  assert.equal(ACTIVITY_MARKER_MAX_AGE_MS,30*60*1000);
  assert.equal(incidentMarkerVisible(event,now+ACTIVITY_MARKER_MAX_AGE_MS-1),true);
  assert.equal(incidentMarkerVisible({...event,lastSeenAt:now+ACTIVITY_MARKER_MAX_AGE_MS},now+ACTIVITY_MARKER_MAX_AGE_MS),false);
  const retained=mergeIncidentEvents([], [event],now+ACTIVITY_MARKER_MAX_AGE_MS);
  assert.equal(retained.length,1);assert.equal(retained[0].eventAt,now);
  assert.equal(incidentMarkerVisible(retained[0],now+ACTIVITY_MARKER_MAX_AGE_MS),false);
  assert.equal(incidentMarkerVisible({...event,confidence:"reported"},now+ACTIVITY_MARKER_MAX_AGE_MS),true);
  assert.equal(incidentMarkerVisible({...event,confidence:"reported"},now+DAY_MS),false);
  for(const invalid of [{lat:null},{lon:NaN},{eventAt:NaN},{eventAt:now+60001}])assert.equal(incidentMarkerVisible({...event,...invalid},now),false);
});

test("last received ground coordinates survive empty polls and reloads; stale airborne positions still expire",()=>{
  let snapshot={records:[ground,{...ground,id:"air-other",identifier:"other",onGround:false}],rejected:[]};
  for(let i=0;i<3;i++)snapshot=mergeAircraftSnapshots({records:[],rejected:[]},JSON.parse(JSON.stringify(snapshot)),now+i*DAY_MS,fleet);
  assert.deepEqual(snapshot.records,[ground]);
  assert.equal(aircraftPositionVisible(ground,now+30*DAY_MS),true);
  assert.equal(aircraftPositionVisible({...ground,onGround:false},now),false);
  assert.equal(aircraftPositionVisible({...ground,onGround:null},now),false);
  for(const invalid of [{lat:91},{observedAt:0},{observedAt:now+60001}])assert.equal(aircraftPositionVisible({...ground,...invalid},now),false);
  assert.equal(mergeAircraftSnapshots({records:[],rejected:[{hex:ground.identifier}]},{records:[ground]},now,fleet).records.length,0);
  assert.equal(mergeAircraftSnapshots({records:[],rejected:[]},{records:[{...ground,name:"G-OTHER"}]},now,fleet).records.length,0);
  assert.equal(mergeAircraftSnapshots({records:[],rejected:[]},{records:[ground]},now,[]).records.length,0);
});

test("new take-offs replace saved ground coordinates and ground symbols suppress every light cycle",()=>{
  const raw={hex:"4077c7",r:"G-GSAS",lat:55.9,lon:-4.3,seen:0,seen_pos:0,gs:80,alt_baro:1000};
  const incoming=normalizeAircraft({now,ac:[raw]},fleet,now);
  const [airborne]=mergeAircraftSnapshots(incoming,{records:[ground]},now,fleet).records;
  assert.equal(airborne.onGround,false);assert.equal(airborne.lat,55.9);assert.equal(airborne.observedAt,now);
  assert.equal(aircraftLightPattern(airborne,now),null);
  for(const category of ["Medical","Police","Coastguard"])assert.equal(aircraftLightPattern({...ground,category,territory:"United Kingdom",squawk:"0023",squawkObservedAt:now},now),null);
  assert.equal(mergeAircraftSnapshots({records:[],rejected:[]},{records:[airborne]},now+900001,fleet).records.length,0);
});

test("an explicit airborne signal with missing or stale coordinates removes the old ground pin without guessing a location",()=>{
  const raw={hex:"4077c7",r:"G-GSAS",seen:0,alt_baro:1000};
  for(const extra of [{},{lat:55.8,lon:-4.2,seen_pos:901}]){
    const incoming=normalizeAircraft({now,ac:[{...raw,...extra}]},fleet,now);
    assert.equal(incoming.records.length,0);assert.equal(incoming.unpositioned[0].onGround,false);
    assert.equal(mergeAircraftSnapshots(incoming,{records:[ground]},now,fleet).records.length,0);
  }
  const unknown=normalizeAircraft({now,ac:[{...raw,alt_baro:undefined}]},fleet,now);
  assert.equal(mergeAircraftSnapshots(unknown,{records:[ground]},now,fleet).records.length,1);
  const unlocatedGround=normalizeAircraft({now,ac:[{...raw,alt_baro:"ground"}]},fleet,now);
  assert.equal(mergeAircraftSnapshots(unlocatedGround,{records:[]},now,fleet).records.length,0);
});
