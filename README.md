# IncidOSINT

UK and Ireland emergency aircraft and rescue-vessel tracker, imported from the current Emergency Air & Sea website.

[Current website](https://logic-uk-ireland-rescue-vessels.starrycapybara8.chatgpt.site/)

## Included features

- Satellite and street maps, search, service filters, aircraft/vessel type silhouettes and service-only map labels.
- A collapsible sidebar that remembers its hidden setting without resetting current filters.
- Aircraft squawk details; red/blue effects for recognised UK SAR and police codes, and yellow/red/blue for medical aircraft. Code-based effects do not confirm an active incident.
- Recorded aircraft flight tracks, explicit position ages, reception gaps and partial-flight labels.
- Shared ADS-B polling and one shared AISStream collector, with aircraft key setup and renewal screens.
- Persistent last-received vessel locations; unknown locations are never substituted with station coordinates.
- Aircraft, vessel and facility watchlists with source references, downloads and attribution.

The imported data contains 181 unique aircraft addresses, 656 vessel records with 497 verified MMSIs, and 1,887 facility records. Coverage is incomplete and aircraft/boat reception varies.

## Source layout

| Path | Purpose |
| --- | --- |
| `app/`, `components/`, `app/globals.css` | Map, detail panels and private setup screens |
| `app/api/`, `lib/` | Shared feeds, validation, position storage, request budgets and flight trails |
| `collector/cloudflare/` | Shared Cloudflare AIS/aircraft worker |
| `collector/` | Alternative collector for an existing computer |
| `data/`, `public/data/` | Fleet records and facility data |
| `db/`, `drizzle/` | D1 schema and SQL migrations |
| `tests/` | Collector, authentication, request-budget and tracking checks |
| `public/setup-guide.html`, `collector/README.md` | Feed connection instructions |

## Development

Requires Node.js 22.13 or later and npm. Install the locked dependencies, then start the development server:

```sh
npm ci
npm run dev
```

Runtime configuration must supply the D1 `DB` binding, apply the migrations in `drizzle/`, and provide the required environment settings. A fresh clone does not contain the deployed database, credentials or received positions. Until storage and feeds are configured, the map can open with feed/setup messages.

The empty values in `.env.example` document configuration names. Use local ignored environment files or the hosting platform's secret settings for actual values. Owner setup remains at `/connect/cloudflare` and `/connect/aircraft`; private Site access and owner identity must also be configured by the hosting environment.

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

The application uses React, Vinext/Vite, Leaflet and Cloudflare Workers/D1. The existing Sites integration and its hosting manifest are retained.

## Hosting and the free budget

This repository is a source import, not a new deployment or an automatic deployment connection. The existing website and collector continue to use their current deployment. Pushing to this GitHub repository alone does not publish website changes. No GitHub Actions deployment or paid service has been enabled.

The production collector is shared across visitors. Anonymous adsb.lol polling uses a local cap of 480 requests per rolling daily allowance, with 180-second spacing; an approved free adhoc key uses a 900-request cap with 95-second spacing. Provider limits can still pause the feed. AISStream uses filtered subscriptions for verified vessel identifiers, and runtime secrets remain on the collector/server.

Keep provider and hosting accounts on their free plans. The application stops at its limits and does not choose a paid fallback. Other usage on those accounts still consumes their shared allowances. Read the existing [setup guide](public/setup-guide.html) and [collector instructions](collector/README.md) before changing deployments. Run one collector, not both alternatives.

## Data and attribution

Source references and data qualifications are retained in each dataset. Existing attribution and third-party licence files are included, including the vessel data pack and bundled map-library licences. Satellite layers and external data retain their own usage terms; this is a non-commercial hobby project. These files do not grant a blanket licence over third-party data or imagery.

## Import provenance

Imported from published source commit `d8cdf959e309683b34502bad097bc16aa8ed41eb` on 22 November 2026, including the squawk display, light effects and collapsible sidebar. Generated collector bundles/maps under `collector/cloudflare/outputs/` are excluded. Runtime secrets, local databases, dependencies, build directories and source Git history are excluded from this import.
