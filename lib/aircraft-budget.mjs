// adsb.lol resets its allowance at 00:00 UTC. Keep reservations atomic across
// collectors, setup checks and map readers; a failed request still spends one.
const DAY = 86_400_000;
export const AIRCRAFT_MIN_POLL_MS = 30_000;
const usedSql = `(CASE WHEN window_start = ?1 OR
  (window_start > ?4 AND window_start % ${DAY} != 0)
  THEN requests ELSE 0 END)`;
export const RESERVE_AIRCRAFT_SQL = `UPDATE feed_state SET
  next_poll_at = MIN(?2, ?3 + MAX(?7,
    CAST((?2 - ?3 + ?6 - ${usedSql} - 1) / (?6 - ${usedSql}) AS INTEGER))),
  requests = ${usedSql} + 1,
  window_start = ?1
  WHERE id = ?5 AND (next_poll_at <= ?3 OR ?8 = 1)
    AND blocked_until <= ?3 AND ${usedSql} < ?6
  RETURNING requests, next_poll_at, window_start`;

/** @param {any} policy @param {any} state */
export function aircraftBudget(policy, state = {}, now = Date.now()) {
  const dayStart = Math.floor(now / DAY) * DAY, resetAt = dayStart + DAY;
  // Retain an overlapping legacy rolling-window count on the first migration.
  // Reset only an expired legacy window or a known previous UTC day.
  const start = Number(state?.window_start) || 0;
  const current = start === dayStart || (start > now - DAY && start % DAY !== 0);
  const used = current ? Math.max(0, Number(state?.requests) || 0) : 0;
  const remaining = Math.max(0, policy.limit - used);
  const intervalMs = remaining ? Math.max(AIRCRAFT_MIN_POLL_MS, Math.ceil((resetAt - now) / remaining)) : resetAt - now;
  return { used, remaining, resetAt, intervalMs,
    nextPollAt: Math.max(Number(state?.next_poll_at) || 0, Number(state?.blocked_until) || 0, remaining ? 0 : resetAt) };
}

export function aircraftReservationArgs(policy, now = Date.now(), validation = false) {
  const dayStart = Math.floor(now / DAY) * DAY;
  return [dayStart, dayStart + DAY, now, now - DAY, "aircraft-adsblol", policy.limit, AIRCRAFT_MIN_POLL_MS, validation ? 1 : 0];
}
