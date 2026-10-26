# Security

Bounded JSON schemas, same-origin writes, HttpOnly SameSite cookies, OAuth state/nonce/PKCE and verified Google JWTs protect accounts. Hash session secrets at rest and expire them. Server controls time, roles, costs, terrain, tax and balances. Local login requires explicit enablement and loopback origin/host.

For a private Tailscale playtest, Vite optionally accepts one explicit HTTPS `.ts.net` origin through `WORLD_PREVIEW_ORIGIN`. Only matching host/origin writes are forwarded as local requests, and preview cookies receive `Secure`. Both development servers bind to loopback; Tailscale Serve provides the tailnet access boundary. Name-based test accounts are shared by preview participants. This development proxy is absent from the deployed Worker.

Atomic command triggers, unique idempotency keys, integer constraints and immutable ledgers defend replay/duplication. Reject self-trading, unowned construction, expired-season actions and filled/cancelled purchases. Rate limits use account IDs or rotating hashed anonymous client IDs. They are an initial defense, not proof against distributed bots or multi-account abuse.

CSP restricts scripts/connections to self. Headers deny framing/sniffing/sensitive referrers. No card data, browser location, provider access tokens or third-party analytics. Metrics are aggregate, with account visit days for retention and test players marked. Reports accept bounded text and existing targets. Admin routes verify roles server-side.

Before launch: configure OAuth redirects/TLS, verify local login disabled, review logging, implement operational deletion/export/retention/incident procedures, provision backups, and use Cloudflare edge challenges if needed. Promote admins explicitly in D1. Blocking accounts prevents authentication and mutations.

Combat and real payments fail closed even if their flags are changed before implementation. Land trading is implemented in database triggers (forced buyouts are bounded by price, protection and a per-pair cooldown) and stays off in production via `LAND_TRADING_ENABLED` until launch tuning. No webhook can grant Gems. Payments require signature verification, unique provider events, refunds/chargebacks and nontransferable entitlements plus launch review.
