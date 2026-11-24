# Selected vessel AIS history

Selecting a registered vessel shows its received AIS trail, defaulting to the
last six hours. The selector offers 30 minutes, 1, 3, 6, 12, 24 and 48 hours.
The route can be hidden or fitted to the map. Switching vessels or periods
removes the previous trail while the selected history loads.

History starts with real reports received after this feature is deployed.
It does not reconstruct earlier voyages. Original report timestamps survive
repeated uploads and outages. Reception gaps over ten minutes and coordinate
jumps requiring over 80 metres/second split the drawn line. Station/base
coordinates are never used as history samples. A new identity assigned to the
same MMSI does not inherit another vessel's trail.

The existing shared AIS collector is unchanged. No extra AISStream connections,
subscriptions or paid history APIs are used. At most one received position per
vessel per 30-second slot is saved, for up to 48 hours. Current last-known vessel
positions keep their existing indefinite retention policy.

Five-minute blocks share a database row across the fleet, rather than writing
one row per vessel report. Compare-and-swap protects concurrent block updates.
Each block is bounded below one MB; expired blocks are deleted in bounded
batches. One shared database lease limits capture to once per 30 seconds and
2,880 batches per rolling day. Read requests never trigger upstream collection.
The public endpoint extracts just the selected vessel inside D1 and has a short
cache lifetime. Unknown MMSIs and unsupported periods are rejected.

The database migration adds only `vessel_trail_windows`; it does not modify
existing positions, aircraft trails, secrets or subscription settings. Storage
failures leave live positions available, and the history response reports a
capture pause. Cloudflare account-wide Free quotas still apply and can stop
service. The implementation does not enable a paid plan or paid fallback.

The selected route now uses a dark outline and bright cyan centre for contrast
on satellite imagery. Start/Latest flags and direction chevrons identify the
recorded path. The map fits the selected period while allowing room for the
details card, and re-fits when the first actual route arrives after a single
position. Single-position and same-location histories explicitly explain why
there is no distinct path. Reception gaps remain open.
