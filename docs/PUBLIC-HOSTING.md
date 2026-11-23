# Public hosting: incidosint.com

The map is intended for public viewing without signing in. `/connect/aircraft`
and `/connect/cloudflare` are owner-only server-rendered pages. Anonymous and
other signed-in visitors do not receive the connection forms. Sites supplies
verified request identity; the server checks it against `COLLECTOR_OWNER_EMAIL`.
Missing owner configuration fails closed. API authorization remains independent
of whether an owner page was opened.

Setup writes accept JSON only from `https://incidosint.com` or the existing
hosted Site origin. Arbitrary Host/Origin combinations do not authorise writes.
Owner pages and setup responses are not cached and are excluded from indexing.
The aircraft key is encrypted in D1. AIS, ingestion, encryption and service
credentials stay in server/collector secrets. The browser MapTiler key is
intentionally public and must be restricted by allowed HTTP origins.

Collector ingestion, leases and status require the existing private bearer token.
Keep the existing collector's `SITE_URL` and private service connection: adding
the public domain does not require a second collector or changing its secrets.
Public visitors share the same upstream leases, quotas and write budgets. Do not
enable a paid hosting plan, automatic top-up or paid data fallback.

The production CSP restricts script and data destinations, disallows plugins,
inline script event attributes and base-tag injection, and permits only the
existing map image providers and embedded provider maps. React's inline
bootstrap scripts and current inline styles remain allowed; this is not a claim
that the policy prevents every XSS attack. Frame embedding is restricted to the
same origin and ChatGPT. Production responses also set HSTS, `nosniff`, a
referrer policy and restrictions on camera, microphone, geolocation and payment.
Development-only evaluation/WebSocket permissions are excluded from production.

## Domain connection

Use the exact ownership, certificate and routing records returned by Sites for
`incidosint.com`. The current apex routing targets are `162.159.143.30` and
`172.66.3.26`; keep their Cloudflare DNS proxy status **DNS only**. Verification
TXT records must remain in DNS. Do not replace the zone or remove unrelated MX,
mail, SPF, DKIM or DMARC records. Leave existing DNSSEC and account protections
enabled. Domain activation is complete only when Sites reports the hostname and
TLS certificate active and the HTTPS map loads on that hostname.

In MapTiler, add `incidosint.com` to this map key's Allowed HTTP Origins while
retaining the existing hosted Site hostname. Use explicit hostnames and retain
the Free plan. An origin restriction is not an authentication mechanism, but it
helps prevent casual third-party use of the shared map allowance. A denied key
falls back to the existing regional imagery; it does not trigger a paid source.

## Validation

`tests/public-access.test.mjs` exercises the real setup API and owner-page gate
with a test substitute for platform identity: anonymous and other signed-in
accounts are denied, the owner is accepted, hostile origins are refused,
unauthenticated collector access is rejected and the public configuration
returns no private credentials. Hosted identity-header validation is owned by
Sites and must not be replaced with client-supplied identity in application code.

Checked 23 November 2026. This is a bounded application review, not a penetration
test or an assurance of uninterrupted availability under arbitrary public load.
