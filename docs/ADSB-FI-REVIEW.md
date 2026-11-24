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

The current background collector always requests an adsb.lol lease and only
allows the adsb.lol provider origin. The map polls the website every 30 seconds.
Selecting ADSB_PROVIDER=adsbfi alone would therefore not configure a working
background adsb.fi feed. Earlier project tests received HTTP 403 from adsb.fi;
access from the actual collector must be checked before switching production.
Provider errors must receive backoff, without changing IPs or bypassing blocks.

Faster polling also requires accounting for the existing 8,000 aircraft-trail
samples/day cap, per-flight point bound, shared D1 writes and public map reads.
Use one coordinated upstream collector, cached public reads, bounded history
storage and fail-closed Free quotas. A reasonable initial integration target
is 15–30 seconds after access and request-size checks; the live provider has
not been changed by this review.
