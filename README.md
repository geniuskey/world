# WORLD

Explore a second Earth, settle a region, grow your territory, and trade resources. React/TypeScript/Vite + Cloudflare Workers/D1. English and Korean. No paid power or real-money payments.

## Development

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run db:migrate
npm run dev
```

Open http://localhost:5174. Vite proxies `/api` to Wrangler on port 8788. The local environment enables a **loopback-only development login**: the same display name resumes a test account. This is not production authentication. Data persists in `.wrangler/state`. Optional labeled test players: `npm run db:demo`. `npm run db:reset` resets only local development data.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests run the actual Worker and migrations against local D1. Browser tests cover desktop and 360px mobile, including two-finger pinch. They start their own servers on ports 5175/8789 and reset only `.wrangler/e2e`, preserving development saves. Optional secrets are documented in `.env.example`; never commit `.dev.vars`.

The current checks cover 28 server/rule/authentication scenarios, 5 geographic mapping scenarios and 16 browser scenarios. Google tests use a signed mock identity provider; a live OAuth client still needs to be configured and checked before deployment.

### Tailscale preview

Use the machine's Tailscale DNS name (from `tailscale status --json`) for a private HTTPS preview:

```sh
WORLD_PREVIEW_ORIGIN=https://<machine>.<tailnet>.ts.net:5174 npm run dev
# In another terminal:
tailscale serve --bg --https=5174 http://127.0.0.1:5174
```

Open that HTTPS address on a device connected to the same tailnet. The explicitly configured preview origin can use the local test accounts; the API stays bound to loopback and rejects writes from other origins. This is a development playtest with shared name-based accounts. Stop sharing with `tailscale serve --https=5174 off`; stop the development server separately. [Tailscale Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Deployment

1. Run `npx wrangler d1 create world`; copy the database ID into `wrangler.jsonc`.
2. Register a Google OAuth web client with redirect `https://world.euiyun.com/api/auth/callback`. Configure `GOOGLE_CLIENT_ID`; install `GOOGLE_CLIENT_SECRET` using `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
3. Review [release requirements](docs/legal-release-checklist.md), confirm `APP_ORIGIN`, and keep local login, combat, land trading and payments disabled.
4. Run `npx wrangler d1 migrations apply world --remote --env=""`, then `npm run deploy`. Bind `world.euiyun.com` as a Worker custom domain in Cloudflare. A local packaging check is `npm run build && npx wrangler deploy --dry-run --env=""`.
5. Grant operator roles explicitly in D1. Recheck Cloudflare prices/quotas before launch. Credentials, DNS, legal review and production OAuth verification are operator supplied.

## Documentation

[Plan](docs/plan.md) · [Decisions](docs/decisions.md) · [Architecture](docs/architecture.md) · [Economy](docs/economy.md) · [Land ownership v2](docs/land-ownership.md) · [Rules](docs/game-rules.md) · [Data](docs/data-model.md) · [Security](docs/security.md) · [Operations](docs/operations.md) · [Map attribution](docs/map-data.md)

Explore a geographic basemap (OpenFreeMap/OpenStreetMap) with forests, fields, hillshaded relief and named peaks, in 2D or on a 3D globe. Territory cells are geographically anchored at approximately 250 m per cell, with location coordinates and an external map link. In South Korea resource terrain follows real land cover (ESA WorldCover) and water cannot be owned; elsewhere terrain is generated. Boundaries are game data, and territory is a permanent game record unrelated to real property. See [map data](docs/map-data.md) for geographic mapping, tile service configuration and attribution.

Every point on Earth is a plot: a Web Mercator zoom-17 tile (about 240 m in Korea), grouped into zoom-14 regions of 8×8 plots. Plot IDs come from coordinates; rows are created only when someone settles or claims a region. Click the map, search coordinates or search a Korean neighbourhood to open a plot, and join to settle that exact plot. Territory grows to orthogonal neighbours, including across region edges. See [map data](docs/map-data.md#plot-grid). The 1,048,576-tile world grid remains as the zoomed-out overview; its version 1 regions are archived ([world tiles](docs/world-tiles.md)). Apply local migrations with `npm run db:migrate`.

The map fills the play viewport, with collapsible region/coordinate controls and a floating plot inspector. Imported WorldPop population estimates generate additional Gold based on residents, with year/source/coverage shown in the UI. See [population data and import commands](docs/map-data.md#population-estimates) and [income rules](docs/economy.md#population-income). Development homepage: https://macstudio.nutria-sole.ts.net:5174/.
