# Shared free aircraft collector

The aircraft collector is a dependency-free Node web service on **Render Free**.
The public website, satellite map, AIS collector and durable history remain on
their existing services. No new aircraft API key is required for adsb.fi.

## Polling and storage

| Operation | Bound |
| --- | --- |
| adsb.fi request starts | At least 2.1 seconds apart |
| One durable permit | At most 14 requests in 30 seconds |
| Shared rolling-day permits | At most 2,880 |
| Maximum reserved adsb.fi requests | 40,320 per rolling day |
| Browser fast-feed checks | Every second, only while visible and unpaused |
| Shared fast-feed cache | Two seconds; no D1 reads |
| Aircraft archive batches | At most once per permit, around 30 seconds |
| Aircraft history writes | Existing 8,000 shared updates per rolling day |
| Anonymous adsb.lol cap | 495 of the documented 500 per UTC day |
| Approved adhoc adsb.lol cap | 990 of the documented 1,000 per UTC day |

Each permit is issued atomically by D1, so overlapping starts and redeploys
cannot create a second upstream polling loop. Unused requests in a permit are
still charged to the local cap. Errors count as requests; HTTP 429 follows
Retry-After, and refusals stop collection. Provider headers never receive the
private coordinator token. Redirects are not followed.

Recent, received fixes are held in memory. The site receives a bounded recent
history batch along with the archive update, preserving original timestamps.
Routine database writes adapt to the remaining allowance. Long flight routes
thin older real samples while retaining the departure and latest positions,
rather than discarding the take-off after 1,000 high-resolution reports.
There is no extrapolation beyond a received fix. Polling every 2.1 seconds
does not guarantee the receiver network supplies a newer fix every time.

## Demand and free hosting

Only real map requests wake the collector. Provider polling stops after one
minute without map demand; no synthetic keep-alive service is configured.
Render Free can sleep after 15 minutes without incoming traffic and can take
about a minute to start again. The existing adsb.lol collector continues in
the background, including while Render sleeps.

Render's 750 Free instance hours, included bandwidth and build minutes are
shared with the workspace's other services. The owner confirmed that the
account has no payment card. Keep it that way and retain the Free instance:
at included limits, service/builds pause instead of buying overages. Render
can also suspend a Free instance for unusually high outbound traffic. There
is no availability guarantee, no paid fallback, and no automatic upgrade.

Official limits: https://render.com/docs/free
Public aircraft terms: https://github.com/adsbfi/opendata
adsb.lol UTC reset: https://www.adsb.lol/docs/open-data/api

## Recovery and source age

Retry-After values are validated before they become a stored deadline. Normal
seconds, HTTP dates, and near-future epoch values are supported; malformed or
implausibly distant values use the existing bounded fallback. The parser
accepts cooldowns up to seven days, below Node's timer-overflow range.

Authenticated collector check-ins repair the impossible HTTP-429 deadlines
created by the previous parser. Repair preserves request counters, allowance
windows, and ordinary provider cooldowns; it does not reset a free quota.

The fast-feed proxy allows 25 seconds per connection attempt, inside the
browser's 30-second request deadline. Render can still need about a minute to
wake. A temporary missing configuration is checked again after 60 seconds,
rather than disabling fast updates for the rest of that page visit. During
startup the map describes the wait without claiming the backup is healthy.
The collector retains original observation times and stops reporting an old
cached fetch as receiving. Its reconnect logs contain only safe error
categories or the coordinator HTTP status, never credentials.

## Configuration

Render runs `node collector/render-aircraft.mjs` without installing the website
dependencies. It listens on `0.0.0.0:$PORT`. Public health checks do not poll an
aircraft source. `/snapshot` requires the private collector token.

- Render: `SITE_URL=https://incidosint.com`, `ADSB_FI_COLLECTOR_TOKEN`.
- Site: the matching secret `ADSB_FI_COLLECTOR_TOKEN`, and `ADSB_FI_FAST_URL`
  set to the returned Render HTTPS origin.
- The dedicated token is unrelated to AIS, owner login, or the adsb.lol key.
  It is never included in browser responses or committed to Git.
- The old Cloudflare supplementary adsb.fi fetch is disabled automatically
  when the dedicated collector token is configured.

## Why Cloudflare collection was failing

On 24 November 2026, the owner successfully used the entire 181-aircraft query
in their normal browser. A bounded request in the official Workers Playground
received an upstream HTTP 403 and an explicit Cloudflare security block page.
Diagnostic Ray ID: `a5fb32702851e85a-FRA`, 20:34:53 UTC.
This is independent of the owner's Cloudflare dashboard sign-in. The Render
collector uses the documented public API, stays within its rate, and stops
if the provider refuses that client too. It does not rotate addresses, use
challenge cookies, impersonate a browser, or use an unauthorised endpoint.
