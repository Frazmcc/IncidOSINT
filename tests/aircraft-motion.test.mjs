import test from "node:test";
import assert from "node:assert/strict";
import {createAircraftMotion,sampleAircraftMotion,AIRCRAFT_ANIMATION_MAX_MS,AIRCRAFT_ANIMATION_GAP_MS} from "../lib/aircraft-motion.mjs";

const now=1_800_000_000_000;
const a={id:"air-test",kind:"aircraft",onGround:false,lat:55.8,lon:-4.2,heading:350,observedAt:now-180_000};
const b={...a,lat:55.82,lon:-4.1,heading:10,observedAt:now};

test("aircraft interpolate at sub-second resolution between received fixes, turn the short way and stop exactly at the latest fix",()=>{
  const motion=createAircraftMotion(a,b,a,now);
  assert.equal(motion.durationMs,AIRCRAFT_ANIMATION_MAX_MS);
  const start=sampleAircraftMotion(motion,now),half=sampleAircraftMotion(motion,now+motion.durationMs/2);
  assert.equal(start.lat,a.lat);assert.equal(start.lon,a.lon);
  assert.equal(half.lat,(a.lat+b.lat)/2);assert.equal(half.lon,(a.lon+b.lon)/2);assert.equal(half.heading,0);
  assert.notEqual(sampleAircraftMotion(motion,now+100).lat,sampleAircraftMotion(motion,now+200).lat);
  assert.deepEqual(sampleAircraftMotion(motion,now+motion.durationMs),{lat:b.lat,lon:b.lon,heading:10,done:true});
  assert.deepEqual(sampleAircraftMotion(motion,now+86400000),{lat:b.lat,lon:b.lon,heading:10,done:true});
  assert.deepEqual(a,{id:"air-test",kind:"aircraft",onGround:false,lat:55.8,lon:-4.2,heading:350,observedAt:now-180000});
});

test("ground transitions, unknown status, vessels, stale or repeated fixes, gaps and implausible jumps never animate",()=>{
  for(const extra of [{onGround:true},{onGround:null},{kind:"vessel"},{id:"air-other"},{observedAt:a.observedAt},{observedAt:now-180001},{observedAt:now+1},{observedAt:NaN},{lat:91},{lat:61,lon:1}])
    assert.equal(createAircraftMotion(a,{...b,...extra},a,now),null);
  assert.equal(createAircraftMotion({...a,onGround:true},b,a,now),null);
  assert.equal(createAircraftMotion({...a,observedAt:now-AIRCRAFT_ANIMATION_GAP_MS-1},b,a,now),null);
  assert.equal(createAircraftMotion(a,b,{lat:NaN,lon:-4},now),null);
});

test("a new fix starts from the currently displayed point without extrapolating or restarting on unchanged data",()=>{
  const first=createAircraftMotion(a,b,a,now),shown=sampleAircraftMotion(first,now+5000);
  const c={...b,lat:55.83,lon:-4.05,observedAt:now+10000,heading:20};
  const second=createAircraftMotion(b,c,shown,now+10000);
  assert.equal(sampleAircraftMotion(second,now+10000).lat,shown.lat);
  assert.equal(createAircraftMotion(b,{...b,squawk:"0032"},shown,now+10000),null);
  assert.equal(sampleAircraftMotion(second,now+30000).lat,c.lat);
});
