# Data model

Migrations: strict schema, command triggers, then deterministic first-season seed. New rules require a new numbered migration and rules version; do not edit applied production migrations.

Identity: users/profiles, hashed sessions, expiring OAuth attempts, permanent account achievements. Game: seasons, regions, territories, structures, player_state, resources. Commands: actions, unique actor/idempotency key. Economy: market_orders, trade_ledger, immutable gold/resource/gems ledgers. Operations: reports, rate_limits, daily_metrics, visits, leaderboard snapshots.

Migration 0004 adds persistent milestone triggers and backfills existing accounts. Migration 0005 blocks purchases from restricted sellers. Migration 0006 indexes resource entries by command ID and trades by season, avoiding a full resource-ledger scan on settlement.

Integer nonnegative balance constraints, foreign keys and unique `(region_id,x,y,season_id)` guard state. Owner/season and region/chunk indexes bound reads. Order status/season/kind, actor/time and expiry indexes support listings, history and cleanup. Outstanding escrow counts toward resource conservation.

Join/settle/claim/build/sell/buy/cancel are trigger-backed transactions. Each verifies season, account, ownership and balances inside the transaction. Order/ledger references derive from action IDs. The server rejects a changed payload under an existing idempotency key.

Per-tile production clocks avoid retroactive earnings. Player aggregates update with ownership and production for bounded ranking queries. Historical season rows and ledgers are retained. Back up production before operational repair.
