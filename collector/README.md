# Shared aircraft and vessel worker — version 2

The guided setup at /connect/cloudflare deploys one SQLite Durable Object for
both feeds. An existing installation can be updated with a temporary Cloudflare
deployment token; leave the AIS key blank to preserve the encrypted secret.

AISStream delivers binary UTF-8 JSON frames. The worker explicitly selects
ArrayBuffer delivery, also decodes Blob frames, negotiates WebSocket compression,
tracks subscription confirmations and reconnects with exponential backoff/jitter.
The three subscriptions contain no more than 200 verified MMSIs each.

Every timer cycle also asks the website for an aircraft polling lease. The D1
lease enforces one shared daily request budget. The worker receives a provider
key only for an authenticated backend poll, then forwards the result for storage
and flight-trail recording. Website visitors read cached positions. Collection
continues without an open map. A configured free aircraft key is encrypted in
the website database; /connect/aircraft manages it privately.

Vessel positions already received remain on the map with their original report
times, even after the feed becomes silent. Unknown vessel locations are never
replaced with station coordinates.

# Guided Cloudflare Free setup

Recommended for this website: open
https://logic-uk-ireland-rescue-vessels.starrycapybara8.chatgpt.site/connect/cloudflare
while signed in as the website owner. Enter your keys there, never in chat.
The owner-only setup checks account subscriptions before deploying one
SQLite-backed collector and transfers secrets directly to Cloudflare.
The temporary Cloudflare deployment token is not saved; revoke it after setup.
The website supplies the private ingest and Site service tokens automatically.

Keep Workers Free selected. Its enforced quotas can stop collection. Paid,
unrecognised or unreadable subscriptions block the guided deployment. Setup
never changes billing or subscribes to services. Run only one collector.

## Advanced manual setup

# Shared AIS collector

No credentials are included. Use only one collector: the Free Cloudflare option OR the Node option, never both. The 497 verified MMSIs are split into at most three filtered AISStream subscriptions. Class A and Class B reports are accepted. Missing and conflicting MMSIs never enter the filter.

## Recommended: one Free Cloudflare Durable Object

1. Create a free AISStream account and get its key. Verify the selected Cloudflare account is on Workers Free and uses SQLite Durable Objects. Do not enable Workers Paid, add a paid fallback, or deploy this into a paid account while expecting a zero bill.
2. In the website runtime secrets, configure a random VESSEL_INGEST_TOKEN of at least 32 characters. Keep it private. On a private ChatGPT Site, obtain supported service access before starting the collector; otherwise the sign-in gate will reject ingestion.
3. From collector/cloudflare, run the trusted official Wrangler CLI: npx wrangler login, then npx wrangler secret put AISSTREAM_API_KEY and npx wrangler secret put VESSEL_INGEST_TOKEN. These commands prompt for hidden values; do not put values in commands, source or wrangler.json. For a private Site, also set SITE_SERVICE_TOKEN if supported service access has been obtained.
4. Confirm the account is Workers Free before running npx wrangler deploy. This package does not upgrade any plan. The configuration has one fixed object name, not one object per visitor. Deploying to a paid account can incur charges; code cannot override an account's billing plan.
5. Start the deployed collector with one authenticated POST to /start. The Authorization header is Bearer followed by the collector token. /stop accepts an authenticated POST; /status accepts an authenticated GET. Do not put the token into a URL.

On Workers Free, platform limits fail closed. One always-awake 128MB object can consume about 11,059 GB-seconds/day, within the current 13,000 free daily allocation but leaving limited room for other use. Other account usage, incoming AIS messages and worker requests consume shared allowances. Free availability is finite. This collector caps itself at 1,000,000 incoming messages per UTC day, persists a bounded snapshot every 30 seconds, and uses server-side MMSI filters. It reconnects after runtime restarts. It cannot promise uninterrupted collection.

Official references: https://developers.cloudflare.com/durable-objects/platform/pricing/ and https://www.aisstream.io/documentation . Checked 22 November 2026; recheck limits before deployment.

## Alternative: an existing always-on computer

Install current Node.js LTS from nodejs.org. From the collector folder run npm install --omit=dev --ignore-scripts --no-audit --no-fund. On Windows, run Start-Collector.ps1; it prompts for the website address and hidden secrets. On other systems set AISSTREAM_API_KEY, VESSEL_INGEST_TOKEN, SITE_URL and, when required, SITE_SERVICE_TOKEN in the process environment, then run node collect.mjs.

The computer must stay on. Its normal electricity and internet use remain your responsibility. This avoids a collector-hosting subscription; it does not make electricity free.

## Status and privacy

The AIS key remains on the collector. Only the website ingest token is sent to the website. The website revalidates identifiers, coordinates and timestamps against its own fleet register. Errors never trigger a paid provider. Authentication errors stop the collector rather than repeatedly retrying invalid credentials. A received timestamp is distinguished from a position-report timestamp. Old reports are never freshened merely because a snapshot is uploaded again.
