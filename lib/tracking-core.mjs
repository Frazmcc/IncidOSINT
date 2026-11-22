import { assetType } from "./asset-types.mjs";
import { normalizeSquawk, SQUAWK_MAX_AGE_MS } from "./aircraft-signals.mjs";
export const DAY_MS = 86_400_000;
export const POSITION_MAX_AGE_MS = 900_000;

// These caps cannot be raised by a visitor or by a URL parameter.
export function aircraftPolicy(provider = "adsblol", hasFreeKey = false, keyTier = "adhoc") {
  if (provider === "adsbfi") return { provider, intervalMs: 30_000, limit: 2_880, name: "adsb.fi", url: "https://opendata.adsb.fi/api/v2/icao/", licence: "Personal, non-commercial use" };
  const adhoc=hasFreeKey&&keyTier==="adhoc";
  return { provider: "adsblol", intervalMs: adhoc ? 95_000 : 180_000, limit: adhoc ? 900 : 480, name: "adsb.lol", url: "https://api.adsb.lol/v2/icao/", licence: "ODbL 1.0" };
}

export const RESERVE_POLL_SQL = `UPDATE feed_state SET
  next_poll_at = ?1,
  window_start = CASE WHEN window_start <= ?2 THEN ?3 ELSE window_start END,
  requests = CASE WHEN window_start <= ?2 THEN 1 ELSE requests + 1 END
  WHERE id = ?4 AND next_poll_at <= ?3 AND blocked_until <= ?3
    AND (window_start <= ?2 OR requests < ?5)
  RETURNING id`;

const finite = value => typeof value === "number" && Number.isFinite(value);
const registrationKey = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const inRegion = (lat, lon) => finite(lat) && finite(lon) && lat >= 48 && lat <= 63.5 && lon >= -14 && lon <= 6;
export function groupFor(category = "") {
  if (/police/i.test(category)) return "Police";
  if (/ambulance|medical|medevac|HEMS/i.test(category)) return "Medical";
  if (/lifeboat/i.test(category)) return "Lifeboat";
  if (/fire/i.test(category)) return "Fire";
  return "Coastguard";
}

export function normalizeAircraft(payload, fleet, receivedAt = Date.now()) {
  const known = new Map(fleet.map(r => [r.icao_hex.toLowerCase(), r]));
  const sourceNow = Number(payload?.now);
  const providerNow = finite(sourceNow) && Math.abs(sourceNow - receivedAt) < DAY_MS ? sourceNow : receivedAt;
  const input = payload?.ac || payload?.aircraft;
  if (!Array.isArray(input)) throw new Error("Aircraft provider returned an unexpected format.");
  const records = [], rejected = [], unpositioned = [];
  for (const item of input) {
    const hex = String(item.hex || "").toLowerCase();
    const meta = known.get(hex);
    if (!meta) continue;
    // Reused/misconfigured addresses and non-aircraft transponders must not
    // acquire an emergency identity solely because they share a static hex.
    if (item.r && registrationKey(item.r) !== registrationKey(meta.registration)) {
      rejected.push({ hex, reason: "Registration disagrees with watchlist" });
      continue;
    }
    if (item.type === "adsb_icao_nt" || /^C[0-9]/.test(item.category || "")) continue;
    const squawk = normalizeSquawk(item.squawk);
    const signalAt = finite(item.seen) && item.seen >= 0 ? providerNow - item.seen * 1000 : null;
    if (!inRegion(item.lat, item.lon) || !finite(item.seen_pos) || item.seen_pos < 0) {
      if (finite(item.seen) && item.seen >= 0 && item.seen <= 120) unpositioned.push({identifier:hex,name:meta.registration,callsign:String(item.flight || "").trim(),service:meta.service,category:groupFor(meta.category),lastSeenAt:signalAt,squawk,squawkObservedAt:signalAt,reason:"Signal received without a usable position"});
      continue;
    }
    const observedAt = providerNow - item.seen_pos * 1000;
    if (receivedAt - observedAt > POSITION_MAX_AGE_MS || observedAt > receivedAt + 60_000) continue;
    records.push({
      id: `air-${hex}`, kind: "aircraft", identifier: hex, name: meta.registration,
      callsign: String(item.flight || "").trim(), service: meta.service,
      category: groupFor(meta.category), fleetCategory: meta.category,
      territory: meta.territory, squawk, squawkObservedAt: signalAt ?? observedAt,
      typeCode: meta.type_code || item.t || "", assetType: assetType({kind:"aircraft",typeCode:meta.type_code || item.t}), fleetStatus: meta.fleet_status, notes: meta.notes,
      lat: item.lat, lon: item.lon, observedAt, receivedAt,
      speed: finite(item.gs) ? item.gs : null,
      heading: finite(item.track) ? item.track : null,
      altitude: finite(item.alt_baro) ? item.alt_baro : item.alt_baro === "ground" ? 0 : null,
      onGround: item.alt_baro === "ground" ? true : finite(item.alt_baro) ? false : null,
      positionSource: String(item.type || "ADS-B / MLAT"), timeBasis: "position report",
      sourceUrl: meta.identity_source, fleetSource: meta.fleet_source,
    });
  }
  return { records, rejected, unpositioned, sourceNow: providerNow };
}

export function mergeAircraftSnapshots(incoming, previous, now=Date.now()) {
  const contradicted=new Set((incoming.rejected || []).map(r=>`air-${r.hex}`));
  const latest=new Map();
  for(const r of [...(previous?.records || []),...(incoming.records || [])]) {
    if(contradicted.has(r.id)||!inRegion(r.lat,r.lon)||!finite(r.observedAt)||now-r.observedAt>POSITION_MAX_AGE_MS||r.observedAt>now+60_000)continue;
    const prior=latest.get(r.id);
    if(!prior||r.observedAt>prior.observedAt||(r.observedAt===prior.observedAt&&(r.receivedAt||0)>(prior.receivedAt||0)))latest.set(r.id,r);
  }
  // A fresh signal can update the code on a saved position without changing
  // its coordinates, position timestamp, or creating a pin for an unseen asset.
  for(const signal of [...(previous?.records||[]),...(incoming.records||[]),...(incoming.unpositioned||[])]) {
    const id=signal.id||`air-${signal.identifier}`,prior=latest.get(id);
    if(!prior||!finite(signal.squawkObservedAt)||signal.squawkObservedAt>now+60_000||now-signal.squawkObservedAt>SQUAWK_MAX_AGE_MS)continue;
    if(!finite(prior.squawkObservedAt)||signal.squawkObservedAt>=prior.squawkObservedAt) {
      latest.set(id,{...prior,squawk:normalizeSquawk(signal.squawk),squawkObservedAt:signal.squawkObservedAt});
    }
  }
  return {...incoming,records:[...latest.values()]};
}

export function normalizeVessels(input, fleet, receivedAt = Date.now()) {
  const known = new Map(fleet.filter(r => /^\d{9}$/.test(r.mmsi || "") && !r.identity_conflict).map(r => [r.mmsi, r]));
  const latest = new Map();
  for (const item of Array.isArray(input) ? input.slice(0, 600) : []) {
    const mmsi = String(item.mmsi || "");
    const meta = known.get(mmsi);
    if (!meta || !inRegion(item.lat, item.lon) || !finite(item.observedAt)) continue;
    if (item.observedAt > receivedAt + 60_000 || receivedAt - item.observedAt > POSITION_MAX_AGE_MS) continue;
    const previous = latest.get(mmsi);
    if (previous && previous.observedAt >= item.observedAt) continue;
    latest.set(mmsi, {
      id: `sea-${mmsi}`, kind: "vessel", identifier: mmsi, name: meta.vessel_name,
      callsign: "", service: meta.service, category: groupFor(meta.category), fleetCategory: meta.category,
      typeCode: meta.class_or_type, assetType: assetType({kind:"vessel",typeCode:meta.class_or_type}), fleetStatus: meta.status, notes: meta.notes,
      lat: item.lat, lon: item.lon, observedAt: item.observedAt, receivedAt,
      speed: finite(item.speed) && item.speed >= 0 && item.speed < 102.3 ? item.speed : null,
      heading: finite(item.heading) && item.heading >= 0 && item.heading < 360 ? item.heading : null,
      altitude: null, positionSource: "AISStream / AIS", timeBasis: item.timeBasis === "received" ? "received" : "position report",
      sourceUrl: meta.identity_source, fleetSource: meta.fleet_source,
    });
  }
  return [...latest.values()];
}

// Retain real vessel observations indefinitely, without changing their times or
// projecting their movement. Removed and conflicting fleet identities are dropped.
export function mergeVesselSnapshots(incoming, previous, fleet, now=Date.now()) {
  const known=new Map(fleet.filter(r=>/^\d{9}$/.test(r.mmsi||"")&&!r.identity_conflict).map(r=>[r.mmsi,r]));
  const latest=new Map();
  for(const r of [...(previous?.records||[]),...(incoming||[])]) {
    const meta=known.get(r.identifier);
    if(!meta||r.name!==meta.vessel_name||!inRegion(r.lat,r.lon)||!finite(r.observedAt)||r.observedAt<=0||r.observedAt>now+60_000)continue;
    if(!latest.has(r.identifier)||r.observedAt>latest.get(r.identifier).observedAt)latest.set(r.identifier,r);
  }
  return [...latest.values()];
}

export function retryDelay(response, now = Date.now()) {
  const retry = response.headers.get("Retry-After");
  const seconds = Number(retry);
  if (retry && Number.isFinite(seconds) && seconds >= 0) return Math.max(180_000, seconds * 1000);
  const date = retry ? Date.parse(retry) : NaN;
  if (Number.isFinite(date)) return Math.max(180_000, date - now);
  return response.status === 429 ? 3_600_000 : response.status >= 400 && response.status < 500 ? DAY_MS : 180_000;
}
