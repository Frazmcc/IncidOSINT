// One shared 30-second permit. Starts are spaced by 2.1 seconds, with room
// below adsb.fi's published one-request-per-second limit.
export const FAST_POLL_MS = 2_100;
export const FAST_LEASE_MS = 30_000;
export const FAST_BATCH_REQUESTS = 14;
export const FAST_DAILY_LEASES = 2_880;
export const FAST_DAILY_REQUESTS = FAST_BATCH_REQUESTS * FAST_DAILY_LEASES;
export const FAST_BUDGET_ID = "aircraft-adsbfi-fast-budget";
export const FAST_USER_AGENT = "IncidOSINT/4.0 (+https://incidosint.com/; personal non-commercial)";
export const FAST_ALLOWED_ORIGIN = "https://opendata.adsb.fi";

export function fastProviderUrl(value) {
  const u = new URL(value);
  if (u.origin !== FAST_ALLOWED_ORIGIN || !/^\/api\/v2\/icao\/[a-f0-9]{6}(,[a-f0-9]{6})*$/i.test(u.pathname) || u.search || u.hash || u.username || u.password) throw Error("Unexpected aircraft provider URL");
  return u;
}

// Only the fields used by the aircraft parser travel in the archive batch.
export function compactAircraftPayload(payload, allowed) {
  if (!Array.isArray(payload?.ac)) throw Error("Unexpected aircraft response");
  const keys = ["hex","type","r","t","flight","category","alt_baro","gs","track","squawk","seen","seen_pos","lat","lon"];
  return {now:payload.now,ac:payload.ac.filter(a=>allowed.has(String(a.hex).toLowerCase())).slice(0,200).map(a=>Object.fromEntries(keys.filter(k=>typeof a[k]==="number"||typeof a[k]==="string"&&a[k].length<100).map(k=>[k,a[k]])))};
}
