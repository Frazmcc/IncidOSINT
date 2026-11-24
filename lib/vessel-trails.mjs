import { inRegion } from "./tracking-core.mjs";
import { distanceMetres } from "./flight-trails.mjs";

export const VESSEL_HISTORY_HOURS = [0.5, 1, 3, 6, 12, 24, 48];
export const VESSEL_HISTORY_DEFAULT_HOURS = 6;
export const VESSEL_HISTORY_RETENTION_MS = 48 * 3_600_000;
export const VESSEL_HISTORY_WINDOW_MS = 300_000;
export const VESSEL_HISTORY_SAMPLE_MS = 30_000;
export const VESSEL_HISTORY_CAPTURE_LIMIT = 2_880;
export const VESSEL_HISTORY_MAX_BYTES = 1_000_000;
export const vesselWindowStart = at => Math.floor(at / VESSEL_HISTORY_WINDOW_MS) * VESSEL_HISTORY_WINDOW_MS;
export const validMmsi = value => /^\d{9}$/.test(String(value || ""));
export const vesselHistoryHours = value => VESSEL_HISTORY_HOURS.includes(Number(value)) ? Number(value) : VESSEL_HISTORY_DEFAULT_HOURS;

const validPoint = p => Array.isArray(p) && p.length === 3 && Number.isFinite(p[0]) && inRegion(p[1], p[2]);

// Time blocks share a write across the fleet. Each retained coordinate and its
// timestamp comes from an actual report; a slot keeps its latest received fix.
export function groupVesselTrailRecords(records, now = Date.now()) {
  const windows = new Map();
  for (const r of records.slice(0, 600)) {
    if (r.kind !== "vessel" || !validMmsi(r.identifier) || !r.name || !inRegion(r.lat, r.lon)
      || !Number.isFinite(r.observedAt) || r.observedAt <= 0 || r.observedAt > now + 60_000 || now - r.observedAt > 900_000) continue;
    const start = vesselWindowStart(r.observedAt);
    if (!windows.has(start)) windows.set(start, []);
    windows.get(start).push(r);
  }
  return windows;
}

export function mergeVesselTrailWindow(previous, records, start) {
  const result = { ...(previous || {}) };
  for (const r of records) {
    if (!validMmsi(r.identifier) || !inRegion(r.lat, r.lon) || !Number.isFinite(r.observedAt) || vesselWindowStart(r.observedAt) !== start) continue;
    const old = result[r.identifier];
    const slots = new Map();
    for (const p of old?.name === r.name ? old.points || [] : []) {
      if (validPoint(p) && vesselWindowStart(p[0]) === start) slots.set(Math.floor(p[0] / VESSEL_HISTORY_SAMPLE_MS), p);
    }
    const slot = Math.floor(r.observedAt / VESSEL_HISTORY_SAMPLE_MS), prior = slots.get(slot);
    if (!prior || r.observedAt > prior[0]) slots.set(slot, [r.observedAt, r.lat, r.lon]);
    result[r.identifier] = { name: r.name, points: [...slots.values()].sort((a, b) => a[0] - b[0]) };
  }
  return result;
}

export function selectedVesselTrail(chunks, name, hours = VESSEL_HISTORY_DEFAULT_HOURS, now = Date.now()) {
  const duration = vesselHistoryHours(hours), from = now - duration * 3_600_000, samples = new Map();
  for (const chunk of chunks) {
    if (chunk?.name !== name) continue;
    for (const p of chunk.points || []) if (validPoint(p) && p[0] >= from && p[0] <= now) samples.set(p[0], { at: p[0], lat: p[1], lon: p[2] });
  }
  const points = [...samples.values()].sort((a, b) => a.at - b.at), segments = [];
  for (const point of points) {
    const segment = segments.at(-1), prior = segment?.at(-1);
    if (!prior || point.at - prior.at > 600_000 || distanceMetres(prior, point) / ((point.at - prior.at) / 1000) > 80) segments.push([point]);
    else segment.push(point);
  }
  return { hours: duration, from, until: now, points, segments, gaps: segments.length > 1, firstAt: points[0]?.at || null, lastAt: points.at(-1)?.at || null };
}
