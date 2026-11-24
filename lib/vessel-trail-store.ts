import { env } from "cloudflare:workers";
import { DAY_MS, RESERVE_POLL_SQL } from "./tracking-core.mjs";
import { groupVesselTrailRecords, mergeVesselTrailWindow, selectedVesselTrail, vesselHistoryHours, vesselWindowStart, VESSEL_HISTORY_CAPTURE_LIMIT, VESSEL_HISTORY_MAX_BYTES, VESSEL_HISTORY_RETENTION_MS, VESSEL_HISTORY_SAMPLE_MS, VESSEL_HISTORY_WINDOW_MS } from "./vessel-trails.mjs";

const STATE = "vessel-trails";
const database = () => (env as Cloudflare.Env).DB;

export async function captureVesselTrails(records:any[], now = Date.now()) {
  const db = database(); if (!db) throw Error("Vessel history storage unavailable");
  await db.prepare("INSERT INTO feed_state(id,snapshot) VALUES(?,?) ON CONFLICT(id) DO NOTHING").bind(STATE, JSON.stringify({ startedAt: now })).run();
  const reserved = await db.prepare(RESERVE_POLL_SQL).bind(now + VESSEL_HISTORY_SAMPLE_MS, now - DAY_MS, now, STATE, VESSEL_HISTORY_CAPTURE_LIMIT).first();
  if (!reserved) return;
  try {
    // Bounded retention also catches up after an extended collector outage.
    await db.prepare("DELETE FROM vessel_trail_windows WHERE window_start IN (SELECT window_start FROM vessel_trail_windows WHERE window_start < ? ORDER BY window_start LIMIT 12)").bind(vesselWindowStart(now - VESSEL_HISTORY_RETENTION_MS)).run();
    for (const [start, incoming] of groupVesselTrailRecords(records, now)) {
      let saved = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const old = await db.prepare("SELECT payload FROM vessel_trail_windows WHERE window_start=?").bind(start).first<{payload:string}>();
        const previous = old ? JSON.parse(old.payload) : {};
        const payload = JSON.stringify(mergeVesselTrailWindow(previous, incoming, start));
        if (payload === old?.payload) { saved = true; break; }
        if (new TextEncoder().encode(payload).length > VESSEL_HISTORY_MAX_BYTES) throw Error("Vessel history block limit reached");
        const result = await db.prepare("INSERT INTO vessel_trail_windows(window_start,payload,updated_at) VALUES(?,?,?) ON CONFLICT(window_start) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE vessel_trail_windows.payload=?")
          .bind(start, payload, now, old?.payload || "{}").run();
        if (result.meta.changes) { saved = true; break; }
      }
      if (!saved) throw Error("Concurrent vessel history update");
    }
    await db.prepare("UPDATE feed_state SET fetched_at=?,last_error=NULL WHERE id=?").bind(now, STATE).run();
  } catch (error) {
    await db.prepare("UPDATE feed_state SET last_error=? WHERE id=?").bind("Some AIS history could not be saved. Current vessel positions remain available.", STATE).run();
    throw error;
  }
}

export async function vesselTrail(mmsi:string, name:string, hours = 6, now = Date.now()) {
  const db = database(); if (!db) throw Error("Vessel history storage unavailable");
  const duration = vesselHistoryHours(hours), from = now - duration * 3_600_000;
  // Extract only the selected vessel inside D1, rather than transferring every
  // boat's history to the Worker or browser. The primary key bounds the scan.
  const result = await db.prepare("SELECT json_extract(payload,?) AS chunk FROM vessel_trail_windows WHERE window_start>=? AND window_start<=? ORDER BY window_start LIMIT ?")
    .bind(`$."${mmsi}"`, vesselWindowStart(from), vesselWindowStart(now), Math.ceil(VESSEL_HISTORY_RETENTION_MS / VESSEL_HISTORY_WINDOW_MS) + 1).all<{chunk:string|null}>();
  const chunks = result.results.filter(row => row.chunk).map(row => JSON.parse(row.chunk!));
  const state = await db.prepare("SELECT snapshot,fetched_at,window_start,requests,last_error FROM feed_state WHERE id=?").bind(STATE).first<{snapshot:string;fetched_at:number;window_start:number;requests:number;last_error:string|null}>();
  const track = selectedVesselTrail(chunks, name, duration, now);
  let startedAt:number|null = null; try { startedAt = JSON.parse(state?.snapshot || "{}").startedAt || null; } catch {}
  return { identifier: mmsi, ...track, recordingStartedAt: startedAt, recordedThrough: state?.fetched_at || null, retentionHours: VESSEL_HISTORY_RETENTION_MS / 3_600_000,
    sampleSeconds: VESSEL_HISTORY_SAMPLE_MS / 1000, partialWindow: !startedAt || startedAt > from,
    captureBudgetPaused: Boolean(state && state.requests >= VESSEL_HISTORY_CAPTURE_LIMIT && now - state.window_start < DAY_MS),
    message: state?.last_error || (track.points.length ? "Recorded AIS positions" : "No AIS history received in this time window yet.") };
}
