# Architecture

`src/`: React UI. `shared/`: schemas and rules. `worker/`: API. `migrations/`: SQLite tables and command triggers. `tests/`: D1 and browser tests. One production Worker serves `/api/*` and built Vite assets. Local development uses a Vite proxy and persisted Wrangler D1.

The global silhouette is a static CDN asset. Region views request only visible 8×8 chunks, debounce camera changes and reuse ETags. Public chunks are identical for everyone; the client colors ownership. Short CDN TTL bounds staleness; successful commands/manual refresh refetch. Polling runs every 120 seconds only in visible tabs. Account responses are private/no-store. Hourly leaderboard snapshots use indexed player aggregates, not a world scan.

D1 has no interactive multi-request transaction. A validated command inserts into `actions`; SQLite triggers validate/apply all effects within that statement. `RAISE(ABORT, ...)` rolls back ownership, balances, escrow and ledgers together. Unique actor/idempotency keys prevent replay; changed payloads under the same key are conflicts. See [D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) and [supported SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/).

Google authorization-code OIDC uses state, nonce, PKCE and JOSE signature/issuer/audience checks. Store the provider subject and pseudonym, not email/access tokens. Sessions are random opaque cookies with only SHA-256 hashes stored. Local identity shortcuts require both an explicit flag and loopback hostname.

Production is lazy per owned tile; no full-world periodic settlement. Scheduled work refreshes rankings and prunes expired operational rows. Logs contain route/status/duration/D1 counters, not IPs or tokens. No WebSocket/SSE, game server, paid map SDK, LLM, payments or browser location.
