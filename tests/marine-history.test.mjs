import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVessels,mergeVesselSnapshots,aircraftPolicy} from '../lib/tracking-core.mjs';
import {decodeStreamMessage,decodePosition} from '../collector/ais-codec.mjs';
import {encryptAircraftKey,decryptAircraftKey} from '../lib/aircraft-key.mjs';
const now=Date.now(),fleet=[{mmsi:'232001234',vessel_name:'Test rescue boat',category:'Lifeboat',service:'Test operator'}];
test('AIS binary Blob, ArrayBuffer and typed-array frames use the documented metadata and retain report coordinates',async()=>{
 const message={MessageType:'PositionReport',MetaData:{MMSI:232001234,Latitude:55.8,Longitude:-4.2,time_utc:new Date(now).toISOString()},Message:{PositionReport:{Valid:true,Sog:12,Cog:50,TrueHeading:51}}};
 const text=JSON.stringify(message),bytes=new TextEncoder().encode(text);
 for(const frame of [text,new Blob([bytes]),bytes.buffer,bytes]){
  const parsed=await decodeStreamMessage(frame),p=decodePosition(parsed,new Set(['232001234']),now);
  assert.equal(p.mmsi,'232001234');assert.equal(p.lat,55.8);assert.equal(p.lon,-4.2);assert.equal(p.speed,12);
 }
 assert.equal(decodePosition({...message,Message:{PositionReport:{Valid:false,Latitude:55,Longitude:-4}}},new Set(['232001234']),now),null);
 await assert.rejects(()=>decodeStreamMessage(new Blob(['invalid JSON'])));
});
test('Vessels remain at their last real position through empty snapshots and months of silence, without refreshing observation times',()=>{
 const [old]=normalizeVessels([{mmsi:'232001234',lat:55,lon:-4,observedAt:now}],fleet,now);
 const later=now+90*86400000;
 const retained=mergeVesselSnapshots([],{records:[old]},fleet,later);
 assert.deepEqual(retained,[old]);assert.equal(retained[0].observedAt,now);assert.equal(retained[0].receivedAt,now);
 const [fresh]=normalizeVessels([{mmsi:'232001234',lat:56,lon:-3,observedAt:later}],fleet,later);
 assert.deepEqual(mergeVesselSnapshots([fresh],{records:[old]},fleet,later),[fresh]);
 assert.deepEqual(mergeVesselSnapshots([old],{records:[fresh]},fleet,later),[fresh]);
 assert.deepEqual(mergeVesselSnapshots([],{records:[old]},[],later),[]);
 assert.deepEqual(mergeVesselSnapshots([],{records:[old]},[{...fleet[0],identity_conflict:true}],later),[]);
 assert.deepEqual(mergeVesselSnapshots([],{records:[old]},[{...fleet[0],vessel_name:'Reassigned MMSI'}],later),[]);
 assert.deepEqual(mergeVesselSnapshots([],{records:[{...old,lat:91}]},fleet,later),[]);
 assert.deepEqual(mergeVesselSnapshots([],{},fleet,later),[]);
});
test('Stored free aircraft keys are encrypted with authenticated tier metadata, and anonymous keys keep the 500/day allowance margin',async()=>{
 const secret='synthetic-encryption-secret-1234567890',key='sk-lol-synthetic-key-for-tests';
 const saved=await encryptAircraftKey(key,secret,'anonymous',now);
 assert.ok(!JSON.stringify(saved).includes(key));assert.deepEqual(await decryptAircraftKey(saved,secret),{value:key,tier:'anonymous',configuredAt:now});
 await assert.rejects(()=>decryptAircraftKey({...saved,tier:'adhoc'},secret));
 await assert.rejects(()=>decryptAircraftKey(saved,secret+'wrong'));
 assert.equal(aircraftPolicy('adsblol',true,'anonymous').limit,495);
 assert.equal(aircraftPolicy('adsblol',true,'anonymous').intervalMs,Math.ceil(86_400_000/495));
 assert.equal(aircraftPolicy('adsblol',true,'adhoc').limit,990);
});
