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

The Reports & activity section separates public reports from detected activity, displays source/status/attribution details, and includes map-pin and in-app alert controls. Detected activity map pins expire 30 minutes after the original `eventAt`; refreshes and selection do not extend that time. Their reports remain in the 24-hour list. Public incident pins keep the existing 24-hour retention. Expiry uses the browser clock and is checked every ten seconds, including while feed updates are paused. Selecting an expired activity opens its detail without restoring the pin or moving the map to it. Both controls are saved in browser-local preferences. In-app alerts are on by default, suppress the initial history load and old events, and do not use push, SMS, email or a paid messaging service. The existing updates-pause control also pauses incident refresh in that browser. Closing or hiding the sidebar does not stop shared collection.

## Validation

`tests/incidents.test.mjs` covers timestamps, locations, XML limits, link preservation, 24-hour retention and balanced detection. `tests/incident-store.test.mjs` exercises the real Worker/D1 API: shared source leases under concurrent viewers, source and write caps, stale entries, redirect protection, retry behaviour and credential isolation. Existing aircraft, vessel, collector and encryption tests continue to apply.

Source policy review: 22 November 2026. Recheck provider terms before changing enabled sources or widening their use.

## Ground aircraft positions

The latest received position is retained indefinitely when ADS-B explicitly reports `alt_baro: "ground"`. These aircraft use a grey symbol with no emergency-light animation; the details show flight status at report and the original position age. A base or landing site is never guessed from watchlist membership, speed, altitude zero, or reception loss. Previously discarded positions cannot be reconstructed by this change. Airborne and unknown-status positions still expire after 15 minutes. A newer positioned observation replaces the ground record; an explicit fresh airborne signal without usable coordinates removes the old ground pin without inventing a new one. Ground retention is bounded to the existing watchlist and rejects conflicting or removed registrations. It uses the existing snapshot and poll budget, with no additional upstream requests or database migration.

## Free alternative road views

The main satellite map links to `/traffic` (the provider-supported Waze Live Map embed) and `/gritters` (the official Transport Scotland public ArcGIS Experience). Each is a separate provider map; attribution, provider controls and map contents remain with the provider. No paid account, API key, bulk scraper, proxy, automatic top-up or new upstream collector is added. These views make browser requests directly to their providers only when opened, rather than using the ADS-B/AIS collectors or D1. Availability and third-party cookies/content depend on the providers. Direct provider links remain visible if embedding fails. The official gritter viewer requires WebGL 2; browsers without it receive a clear compatibility message and a direct link instead of an empty frame. The cloud QA browser lacks WebGL 2, so its gritter rendering could not be visually verified; the public app source, embed destination and compatibility fallback were verified.

Waze's [iframe guidance](https://developers.google.com/waze/iframe/) permits embedding its own Live Map and prohibits associating its content or branding with a non-Waze map. Its [incident-download feed](https://support.google.com/waze/partners/answer/13458165?hl=en) requires approved partner access. The embed does not turn Waze reports into pins in our satellite view, notifications, or 24-hour incident history. Preset areas cover Scotland and the UK/Ireland; no location permission or personal-location transmission is requested.

The gritter view uses exactly the Experience linked by the [official Traffic Scotland page](https://www.traffic.gov.scot/gritter-tracker): `https://experience.arcgis.com/experience/ba7dbd0ddf304ec7871c809ef6c81999`. [Esri documents embedding public Experiences](https://support.esri.com/en-us/knowledge-base/how-to-prepare-an-experience-in-arcgis-experience-build-000034207). The public [Winter Gritters Layer item](https://transportscot.maps.arcgis.com/home/item.html?id=a256a6b57fa440daa50fc2974d80f219) credits © Esri UK Limited 2025 and © Transport Scotland 2025; no open republication licence was established for raw vehicle data. Consequently the raw FeatureServer is not polled or copied into our own map/database. This is an official tracker view, not a claim that a gritter overlay has been licensed. Trunk-road coverage excludes local council fleets. Vehicle passage does not establish that a road was treated; live tracking is seasonal.

The [Scottish Road Works Register disruptions export](https://roadworks.scot/opendata) is an OGL-licensed alternative for disruption context, but its daily extract is not a live collision or emergency-dispatch feed. It has not been connected in this update. Source review: 23 November 2026.

## Marker livery and layout

Air ambulances use solid yellow. Coastguard symbols use a red-and-white fill; these two services retain their livery even when a SAR code is present. Other eligible aircraft retain the existing recent UK squawk light rules. Aircraft explicitly reported on the ground remain plain grey without flashing. Squawks and their original report ages stay in details. The top search/header bar is removed; the IncidOSINT name is a standalone map overlay. The hideable sidebar retains filters, coverage information and free connection access.


## Aircraft rendering and received resolution

Aircraft markers are retained across refreshes and selection changes. New received airborne fixes interpolate on the browser animation clock for at most 20 seconds, including shortest-direction heading changes. The marker stops at the latest received fix: there is no future projection or synthetic route capture. Ground transitions, unknown flight status, reports older than three minutes, gaps over six minutes and implausible jumps snap to the received position. Reduced-motion preferences and paused updates disable interpolation. Hidden-tab catch-up settles at the received endpoint. Vessels retain their existing motion-colour rules.

Flight-track lines render every stored received vertex without Leaflet simplification. The selected track refreshes when a new shared aircraft snapshot arrives as well as on its existing timer. Upstream request counts, aircraft key tiers, shared leases, free daily limits and route-write budgets are unchanged. The configured anonymous adsb.lol key permits 500 requests/day; the application retains its 480/day safety cap and 180-second target. Animation improves transitions; it does not provide second-by-second observations. An approved free adhoc key retains the existing 900/day cap and 95-second target.
