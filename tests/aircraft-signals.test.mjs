import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSquawk,aircraftLightPattern,squawkMeaning} from "../lib/aircraft-signals.mjs";
import {normalizeAircraft,mergeAircraftSnapshots} from "../lib/tracking-core.mjs";

const now=1_800_000_000_000;
const fleet=[{icao_hex:"407083",registration:"G-POLS",category:"Police",territory:"United Kingdom"}];
const raw={hex:"407083",r:"G-POLS",lat:55.8,lon:-4.2,seen:1,seen_pos:5,squawk:"0032"};
const normalized=(item,at=now)=>normalizeAircraft({now:at,ac:[item]},fleet,at);

test("four-digit octal squawks preserve leading zeroes and reject malformed values",()=>{
  for(const [input,expected] of [["0023","0023"],[32,"0032"],["0","0000"],["7000","7000"],[" 0020 ","0020"]])assert.equal(normalizeSquawk(input),expected);
  for(const invalid of [null,undefined,true,{},"0088","77777","-23",23.5,Infinity,""])assert.equal(normalizeSquawk(invalid),null);
  const r=normalized(raw).records[0];assert.equal(r.squawk,"0032");assert.equal(r.squawkObservedAt,now-1000);assert.equal(r.observedAt,now-5000);
});

test("recent UK SAR and police codes use red/blue; medical aircraft always use three colours",()=>{
  const r=normalized(raw).records[0];
  assert.equal(aircraftLightPattern(r,now),"red-blue");
  assert.equal(aircraftLightPattern({...r,category:"Coastguard",squawk:"0023"},now),"red-blue");
  for(const code of ["0041","0047","0054","0057","0061"])assert.equal(aircraftLightPattern({...r,squawk:code},now),"red-blue");
  for(const code of ["0040","0062","0058"])assert.equal(aircraftLightPattern({...r,squawk:code},now),null);
  assert.equal(aircraftLightPattern({...r,category:"Coastguard",squawk:"0054"},now),null);
  assert.equal(aircraftLightPattern({...r,territory:"Republic of Ireland",squawk:"0032"},now),null);
  for(const code of ["7000","0020",null])assert.equal(aircraftLightPattern({...r,squawk:code},now),null);
  assert.equal(aircraftLightPattern({...r,squawkObservedAt:now-180001},now),null);
  assert.equal(aircraftLightPattern({...r,squawkObservedAt:now+60001},now),null);
  assert.equal(aircraftLightPattern({...r,territory:"Ireland"},now),null);
  assert.equal(squawkMeaning({...r,territory:"Ireland"}),null);
  assert.equal(aircraftLightPattern({...r,category:"Medical",territory:"Ireland",squawk:null,squawkObservedAt:now-600000},now),"medical");
  assert.equal(aircraftLightPattern({...r,kind:"vessel",category:"Medical"},now),null);
});

test("a changed or missing code replaces the saved code without making a stationary position newer",()=>{
  const previous=normalized(raw),at=now+30000;
  const samePosition={...raw,seen_pos:35,seen:0,squawk:"7000"};
  const merged=mergeAircraftSnapshots(normalized(samePosition,at),previous,at).records[0];
  assert.equal(merged.observedAt,now-5000);assert.equal(merged.squawk,"7000");assert.equal(aircraftLightPattern(merged,at),null);
  const missing=mergeAircraftSnapshots(normalized({...samePosition,squawk:undefined},at),previous,at).records[0];
  assert.equal(missing.squawk,null);
});

test("signal-only squawk updates retain old coordinates; unseen aircraft do not acquire a map position",()=>{
  const at=now+30000,report=normalized({...raw,lat:undefined,lon:undefined,seen:0,squawk:"7000"},at);
  assert.equal(report.records.length,0);assert.equal(report.unpositioned[0].squawk,"7000");
  const result=mergeAircraftSnapshots(report,normalized(raw),at).records[0];
  assert.equal(result.observedAt,now-5000);assert.equal(result.lat,raw.lat);assert.equal(result.receivedAt,now);assert.equal(result.squawk,"7000");assert.equal(result.squawkObservedAt,at);
  assert.equal(mergeAircraftSnapshots(report,{records:[]},at).records.length,0);
  assert.equal(mergeAircraftSnapshots({...report,rejected:[{hex:raw.hex}]},normalized(raw),at).records.length,0);
});

test("newer coordinates cannot roll back a more recently received squawk",()=>{
  const before=normalized({...raw,seen_pos:60,seen:0,squawk:"7000"});
  const after=normalized({...raw,seen_pos:1,seen:40,squawk:"0032"},now+10000);
  const r=mergeAircraftSnapshots(after,before,now+10000).records[0];
  assert.equal(r.observedAt,now+9000);assert.equal(r.squawk,"7000");assert.equal(r.squawkObservedAt,now);
});
