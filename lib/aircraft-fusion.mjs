import { aircraftPositionVisible, mergeAircraftSnapshots } from "./tracking-core.mjs";
import { distanceMetres } from "./flight-trails.mjs";

// Observations, not animation frames, are merged. A provider's rejected hex
// cannot erase an independently validated observation from another provider.
/**
 * @param {any[]} snapshots
 * @param {number} now
 * @param {Array<{icao_hex:string,registration:string}>|null} fleet
 */
export function combineAircraftSnapshots(snapshots, now = Date.now(), fleet = null) {
  const latest = new Map();
  const candidates = snapshots.flatMap(s => s?.records || []).filter(r => aircraftPositionVisible(r, now)).sort((a,b) => a.observedAt-b.observedAt);
  for (const r of candidates) {
    const old = latest.get(r.id);
    if (old && r.observedAt <= old.observedAt) continue;
    if (old && r.onGround === false && old.onGround === false) {
      const elapsed = (r.observedAt-old.observedAt)/1000;
      if (elapsed < 360 && distanceMetres(old,r)/elapsed > 450) continue;
    }
    latest.set(r.id,r);
  }
  const signals = new Map();
  for (const r of snapshots.flatMap(s => s?.unpositioned || [])) {
    if (!signals.has(r.identifier) || r.lastSeenAt > signals.get(r.identifier).lastSeenAt) signals.set(r.identifier,r);
  }
  const result = mergeAircraftSnapshots({records:[...latest.values()],rejected:[],unpositioned:[...signals.values()]},{records:[]},now,fleet);
  return {...result,rejected:snapshots.flatMap(s => s?.rejected || [])};
}

/** @param {any[]} records @param {any[]} initial @param {number} now @param {Array<{icao_hex:string,registration:string}>|null} fleet */
export function trustedAircraftHistory(records, initial, now=Date.now(), fleet=null){
 let state={records:initial||[]};const accepted=[];
 for(const record of [...records].sort((a,b)=>a.observedAt-b.observedAt)){
  const prior=state.records.find(r=>r.id===record.id),next=combineAircraftSnapshots([state,{records:[record]}],now,fleet);
  if((!prior||record.observedAt>prior.observedAt)&&next.records.some(r=>r.id===record.id&&r.observedAt===record.observedAt&&r.lat===record.lat&&r.lon===record.lon))accepted.push(record);
  state=next;
 }
 return accepted;
}
