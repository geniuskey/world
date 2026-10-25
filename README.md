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

The current checks cover 28 server/rule/authentication scenarios and 12 browser scenarios. Google tests use a signed mock identity provider; a live OAuth client still needs to be configured and checked before deployment.

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

[Plan](docs/plan.md) · [Decisions](docs/decisions.md) · [Architecture](docs/architecture.md) · [Economy](docs/economy.md) · [Rules](docs/game-rules.md) · [Data](docs/data-model.md) · [Security](docs/security.md) · [Operations](docs/operations.md) · [Map attribution](docs/map-data.md)

Territory is a seasonal game permission, unrelated to real property. The global silhouette uses public-domain Natural Earth data; regional cells are fictional logical terrain.
