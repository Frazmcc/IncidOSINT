export const SQUAWK_MAX_AGE_MS = 180_000;

export function normalizeSquawk(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const code = String(value).trim();
  return /^[0-7]{1,4}$/.test(code) ? code.padStart(4, "0") : null;
}

// CAA SARG policy 130, sections 5.1 and 5.3. These are UK assignments;
// they do not establish an emergency or describe Irish code assignments.
// https://www.caa.co.uk/publication/download/20508
// Police range: UK AIP ENR 1.6-10, AMDT 09/2024, published by NATS.
// The range is used only for a known UK police fleet record; do not infer
// police identity or an incident from a code alone.
export function squawkMeaning(record) {
  if (record?.territory !== "United Kingdom") return null;
  const code = normalizeSquawk(record.squawk);
  if (code === "0023") return "SAR squawk · UK assignment";
  if (code === "0032") return "Police air-support squawk · UK assignment";
  if (record.category === "Police" && code && code >= "0041" && code <= "0061") return "Police air-support squawk · UK assignment";
  return null;
}

export function squawkIsRecent(record, now = Date.now()) {
  const at = record?.squawkObservedAt;
  return Number.isFinite(at) && at <= now + 60_000 && now - at <= SQUAWK_MAX_AGE_MS;
}

export function aircraftLightPattern(record, now = Date.now()) {
  if (record?.kind !== "aircraft" || record.onGround === true) return null;
  // These services retain their chosen livery colours, even on a SAR code.
  if (record.category === "Medical" || record.category === "Coastguard") return null;
  return squawkIsRecent(record, now) && squawkMeaning(record) ? "red-blue" : null;
}
