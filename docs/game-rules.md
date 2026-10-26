# Rules v1

- Territory is permanent (land ownership v2, migration 0011). The active season ends at `9999-12-31T23:59:59Z` and is never rotated; seasons remain only as the record key for rankings and history. Commands still require active status and `begins_at <= now < ends_at`, so an operator can still close a world. Isolated pilots can use 7- or 30-day seasons.
- The whole world uses one global grid. Choose any world cell on the map to explore an 8×8 local settlement grid; plots are allocated on first settlement. There are no preset cities. Coordinates are `(season, region, x, y)`, not real parcels.
- Designated starting sites allocate atomically with the grant. Exhaustion returns `REGION_FULL` with no partial grant.
- A claim requires unowned land and a same-owner orthogonal neighbor in the same region/season. Cost: one energy. Water and diagonal-only neighbors are invalid.
- `energy = min(4, stored + floor((now - updated_at) / 21600))`. Preserve fractional recovery unless capped; spending from full starts a new clock.
- Tile periods: `min(28, floor((now - production_at) / 21600))`. Retain fractional time. Before construction, settle then restart the tile clock to prevent retroactive bonuses.
- Rank score: `10 × territory_count + cumulative_resource_production`. Show territory count and production rate separately. Hourly snapshots display their timestamp.
- Pilot seasons create new region/territory rows. Accounts/history survive; joining grants fresh seasonal inventory. Expired seasons reject commands. No destructive automated reset.
- Combat, land transfer and payments are disabled. Territory is a permanent fictional game record. Money never buys energy, power or expansion reach.
