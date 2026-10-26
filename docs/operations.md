# Operations

## Local playtest

`npm run db:migrate && npm run dev` starts the persistent world at http://localhost:5174. `npm run db:demo` adds three explicitly labeled playtest accounts with market offers: **World Demo Mira**, **World Demo Sol**, **World Demo Jun**. Enter one of those names through local login to resume it. The seed is repeatable and cannot target remote D1.

Stop the dev server before `npm run db:reset`; it deletes only this checkout's local D1 files and reapplies migrations. Browser tests use `.wrangler/e2e` on ports 5175/8789, independently of development state. Vitest creates temporary D1 instances and disposes them afterward.

## Roles and reports

Authenticate through Google on the deployed service, obtain your own ID from `/api/me`, and grant the role explicitly in the D1 console:

```sql
UPDATE users SET role = 'admin' WHERE id = '<verified account id>';
```

The `/admin` page shows daily API/cache/row counters, Gold supply/tax, escrow, playtest versus live account counts, eligible D1/D7 retention cohorts, weekly actions and reports. Resolving a report is an authenticated, role-checked action. Account restrictions are an explicit operator database action:

```sql
UPDATE users SET status = 'blocked' WHERE id = '<reviewed account id>';
```

A blocked account cannot use its sessions; its offers disappear from public listings and stale purchase requests are rejected. Blocking does not confiscate assets or edit ledgers. Check the target and record the moderation decision in your operational process.

Counters include Worker API requests. D1 row counters measure game/auth queries; the metrics row's own write is excluded. Cache hits still execute a Worker and write one aggregate metric row. Static CDN assets bypass the API. Visits are deduplicated by account/day/event; they measure active days, not individual browsing sessions. Platform billing and retention reporting should be compared with Cloudflare's own dashboard before scaling.

## A new season

An expired active season rejects new game commands while its records remain readable. Starting the next season is an operator operation after backup and validation, not a destructive scheduled reset.

Territory is permanent (see [land ownership v2](land-ownership.md)): do not rotate the production season. Migration 0011 makes the active season permanent. A fresh database or an isolated pilot can generate a season with a new identifier and an explicit output path:

```sh
node scripts/world.mjs s2 permanent .wrangler/season-s2.sql
```

Use `7` or `30` instead of `permanent` for a time-limited pilot. The default output is `.wrangler/season-<id>.sql`; never overwrite an applied migration to reset production. The file inserts only the season. Global regions and plots are created on demand, with no preset cities. End the preceding season only after its `ends_at` has passed, then apply the reviewed new-season file to the intended database. Do not reuse a season ID. The unique active-season constraint blocks accidental overlap.

Existing users choose a new starting region and receive a fresh seasonal grant. Old territory, ledgers, trades and account achievements remain. Expired offers remain frozen in the historical season's escrow and cannot transfer assets into a new season. The integration suite simulates this transition and checks preserved history and achievements.

## Release limits

Live Google OAuth, Cloudflare D1 provisioning, the custom domain and regional release review are external launch tasks. Provider-mocked OAuth tests validate state/nonce/PKCE/signatures but do not verify a real Google console configuration. No production deployment or real payment was performed. Combat and real payments fail closed, even if someone changes their placeholder flags. Land trading is off in production (`LAND_TRADING_ENABLED`) until its parameters are tuned; the buyout premium, protection and cooldown live in the `land_rules` table and change with a reviewed `UPDATE land_rules SET …` rather than a deploy.
