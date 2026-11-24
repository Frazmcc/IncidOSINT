# adsb.fi free feed review — 24 November 2026

Source: https://github.com/adsbfi/opendata/blob/main/README.md
Reviewed README blob: `1860970c7754fc3fcab241ae0e25298089d526a7`.

The documented public base URL is `https://opendata.adsb.fi/api/`. Public endpoints
are limited to one request/second; the README lists no separate daily allowance
or API key requirement. `/v2/icao/` accepts a comma-separated list (documented
with two ICAOs). The full 181-aircraft watchlist still needs a bounded live
compatibility check before assuming the entire batch is accepted.

A shared 15-second poll would use 5,760 upstream requests/day; a 30-second poll
uses 2,880/day. Both are below the advertised request rate. The public API does
not promise a new aircraft observation on every request. The snapshot endpoint
is for receiver contributors and refreshes twice/minute; it is not the public
endpoint to use for this project.

Terms permit personal, non-commercial use, prohibit licensing/selling/renting
the data or service, require adsb.fi credit and a homepage link, and allow access
to be suspended. These terms are not a guarantee of unlimited free availability.

Before the dual-source implementation, the background collector always requested an adsb.lol lease and only
allows the adsb.lol provider origin. The map polls the website every 30 seconds.
Selecting ADSB_PROVIDER=adsbfi alone would therefore not configure a working
background adsb.fi feed. Earlier project tests received HTTP 403 from adsb.fi;
access from the actual collector must be checked before switching production.
Provider errors must receive backoff, without changing IPs or bypassing blocks.

Faster polling also requires accounting for the existing 8,000 aircraft-trail
samples/day cap, per-flight point bound, shared D1 writes and public map reads.
Use one coordinated upstream collector, cached public reads, bounded history
storage and fail-closed Free quotas. A reasonable initial integration target
is 15–30 seconds after access and request-size checks; this review initially left the live provider unchanged. The implementation
below now checks both sources while preserving their separate budgets.

## Shared dual-source implementation

Authenticated collector lease check-ins now also run one centrally leased
adsb.fi public batch check, at most once per 30 seconds and 2,880 times per
rolling day. The existing Cloudflare collector still receives its normal
adsb.lol lease; no collector redeployment or extra API key is required.
`ADSB_FI_ENABLED=false` disables the supplementary check.

No private website or adsb.lol credentials are sent to adsb.fi. Requests time
out after five seconds. HTTP 403 pauses the supplementary source for a day;
429 uses the existing Retry-After/backoff rules. A refusal does not stop the
primary source. Live source health is shown under Coverage limits.

Snapshots merge by verified aircraft identity and original observation time,
not response arrival time. Duplicates and implausible airborne jumps are
excluded, and one source's rejected registration cannot erase a validated
record from the other. Animation lasts at most 30 seconds and stops at the
received fix. Public map reads poll a five-second shared cache every ten
seconds; readers never initiate supplementary source checks.

Aircraft trail writes retain their existing 8,000-sample daily cap. Routine
recording spacing adapts to the number of airborne aircraft and remaining
allowance. Observed departure/landing transitions are prioritised; repeated
idle ground reports are retained in live snapshots without repeated trail
writes. Faster visual movement does not imply every animation frame is a
received or stored position.

## Subsequent collector update

The hosted Worker test confirmed an upstream Cloudflare security block on
24 November 2026. The full public query worked in the owner’s normal browser.
The dedicated Render Free collector, durable permits, two-second shared cache,
high-resolution history batches and enforced allowances are documented in
[FAST-AIRCRAFT.md](FAST-AIRCRAFT.md). When its token is configured, the earlier
Cloudflare supplementary polling path is disabled; its 30-second policy only
applies to the legacy integration.
