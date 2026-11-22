# Incident reports and detected activity

This layer has no paid API, account creation, geocoder, external notification service or automatic paid fallback. It preserves the existing ADS-B and AIS request budgets and collector deployment.

## Enabled sources

| Source | Feed | Interval / fixed rolling daily cap | Reuse basis |
| --- | --- | --- | --- |
| Traffic Wales | `https://traffic.wales/feeds/incidents-events/rss.xml` | 5 minutes / 288 | [Developer RSS guidance](https://traffic.wales/developers) and [Crown copyright / Open Government Licence](https://traffic.wales/copyright-statement) |
| TrafficWatchNI | `https://rss.trafficwatchni.com/trafficwatchni_incidents_rss.xml` | 5 minutes / 288 | [RSS terms](https://www.trafficwatchni.com/twni/terms-and-conditions) and [Crown copyright](https://trafficwatchni.com/twni/crown-copyright) |

Traffic Wales and DfI Traffic Information and Control Centre are credited on reports. Provider links are retained; no logos, camera images or third-party map data are copied. Network errors, redirects and provider limits pause a source. Retry-After is respected. Free source availability is not guaranteed. This first release does not provide complete UK/Ireland road-incident coverage.

## Sources left disabled

- RNLI: its [website terms, section 7](https://rnli.org/footer/terms-and-conditions), require written permission for republication beyond their permitted personal uses. The public pager web service is not called.
- Traffic Scotland DATEX II: registration and approval required through the official developer hub.
- National Highways: the appropriate free registration/licence has not been connected.
- London Fire Brigade, Scottish Fire and Rescue, HM Coastguard: source links are provided; permitted automated live feeds have not been verified. Public statements are not treated as complete live dispatch feeds.

There is no runtime switch or URL query that enables these sources. Any future connector must establish free access, reuse permission, a supported feed and its source limits first.

## Collection and storage

The existing shared collector posts to `/api/collector/aircraft` while the map is closed. Authenticated check-ins also schedule source refresh with the Site Worker's `ctx.waitUntil`; aircraft leases are not delayed. No external collector redeployment or extra secrets are required. `/api/incidents` can also trigger a refresh when viewed. Both routes share an atomic D1 reservation before any source request, so viewers do not multiply upstream polling.

Incident rows use the existing `feed_state` table. New databases still need the existing project migrations; no new production schema migration is needed. Writes for activity state and the bounded event snapshot have a shared 6,000-reservation rolling daily cap. Storage retains at most 250 visible events and 800 asset states per kind. Source calls and their status bookkeeping are separately bounded by the source request caps. Nothing changes an account's billing plan; existing free hosting limits still apply and may stop service.

The browser checks the shared incident snapshot every 30 seconds. The two RSS providers publish about every five minutes, and publication delays remain possible. Source item timestamps are never replaced by a channel timestamp or a fetch time. Undated reports retain their first received time. Reports older than 24 hours leave the view, including old items returned in a recently generated feed. Source errors preserve earlier report times. Planned works/events are excluded unless explicitly associated with an emergency incident.

## Balanced activity detection

- Aircraft departure: an explicit ground-to-air transition, at least 20 kt, with fresh received positions and no gap over ten minutes. First appearing airborne does not prove a departure.
- UK SAR/police squawk: a recent received UK-assigned code, using the existing squawk rules. Switching between police codes does not create repeated alerts. These records report the observed signal and do not confirm tasking.
- Vessel underway: a received stationary report at no more than 1 kt, followed by two fresh moving reports at 5 kt or above and at least 300 m displacement. Initial vessels already underway, stale positions and small GPS drift do not establish a launch.

Training, routine work and repositioning can produce these observations. Inferred events are labelled unconfirmed. Their map pins are the asset positions at detection, never asserted incident locations. Public reports without coordinates stay in the list; no station coordinate or paid geocoding is substituted.

## Map and alerts

The Reports & activity section separates public reports from detected activity, displays source/status/attribution details, and includes map-pin and in-app alert controls. Both controls are saved in browser-local preferences. In-app alerts are on by default, suppress the initial history load and old events, and do not use push, SMS, email or a paid messaging service. The existing updates-pause control also pauses incident refresh in that browser. Closing or hiding the sidebar does not stop shared collection.

## Validation

`tests/incidents.test.mjs` covers timestamps, locations, XML limits, link preservation, 24-hour retention and balanced detection. `tests/incident-store.test.mjs` exercises the real Worker/D1 API: shared source leases under concurrent viewers, source and write caps, stale entries, redirect protection, retry behaviour and credential isolation. Existing aircraft, vessel, collector and encryption tests continue to apply.

Source policy review: 22 November 2026. Recheck provider terms before changing enabled sources or widening their use.
