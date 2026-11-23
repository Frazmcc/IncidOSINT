import {INCIDENT_RETENTION_MS} from "./incident-sources.mjs";

export const ACTIVITY_MARKER_MAX_AGE_MS=30*60*1000;
export const GROUND_AIRCRAFT_COLOR="#aab4bf";

// Expiry uses the original observation, never a fetch or last-seen time.
// Report history is retained separately for 24 hours.
export function incidentMarkerVisible(event,now=Date.now()) {
  if(!Number.isFinite(event?.lat)||!Number.isFinite(event?.lon)
    ||!Number.isFinite(event?.eventAt)||event.eventAt<=0||event.eventAt>now+60_000)return false;
  return now-event.eventAt < (event.confidence==="inferred" ? ACTIVITY_MARKER_MAX_AGE_MS : INCIDENT_RETENTION_MS);
}
