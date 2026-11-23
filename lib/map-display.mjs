import {INCIDENT_RETENTION_MS} from "./incident-sources.mjs";

export const ACTIVITY_MARKER_MAX_AGE_MS=30*60*1000;
export const GROUND_AIRCRAFT_COLOR="#aab4bf";
export const LIFEBOAT_IDLE_COLOR="#aab4bf";
export const LIFEBOAT_MOVING_COLOR="#ff9b43";
export const LIFEBOAT_MOVEMENT_MAX_AGE_MS=180_000;
export const LIFEBOAT_MOVEMENT_MIN_KNOTS=1;

// Use the original AIS report's speed and age. A retained location or a new
// website fetch cannot confirm movement; low speeds can be moored GPS drift.
export function lifeboatMovementConfirmed(record,now=Date.now()) {
  return record?.kind==="vessel" && record.category==="Lifeboat"
    && Number.isFinite(record.observedAt) && record.observedAt>0 && record.observedAt<=now
    && now-record.observedAt<=LIFEBOAT_MOVEMENT_MAX_AGE_MS
    && Number.isFinite(record.speed) && record.speed>=LIFEBOAT_MOVEMENT_MIN_KNOTS
    && record.speed<102.3;
}

export function lifeboatColor(record,now=Date.now()) {
  return lifeboatMovementConfirmed(record,now) ? LIFEBOAT_MOVING_COLOR : LIFEBOAT_IDLE_COLOR;
}

// Expiry uses the original observation, never a fetch or last-seen time.
// Report history is retained separately for 24 hours.
export function incidentMarkerVisible(event,now=Date.now()) {
  if(!Number.isFinite(event?.lat)||!Number.isFinite(event?.lon)
    ||!Number.isFinite(event?.eventAt)||event.eventAt<=0||event.eventAt>now+60_000)return false;
  return now-event.eventAt < (event.confidence==="inferred" ? ACTIVITY_MARKER_MAX_AGE_MS : INCIDENT_RETENTION_MS);
}
