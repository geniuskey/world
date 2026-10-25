# Rules v1

- Seasons default to 30 days; initialization supports a seven-day pilot. Server UTC controls boundaries. Commands require active status and `begins_at <= now < ends_at`.
- Three fictional 24×24 regions are anchored near Han River, Tagus Coast and Great Lakes. Coordinates are `(season, region, x, y)`, not real parcels. Active cells stay below 256×256.
- Designated starting sites allocate atomically with the grant. Exhaustion returns `REGION_FULL` with no partial grant.
- A claim requires unowned land and a same-owner orthogonal neighbor in the same region/season. Cost: one energy. Water and diagonal-only neighbors are invalid.
- `energy = min(4, stored + floor((now - updated_at) / 21600))`. Preserve fractional recovery unless capped; spending from full starts a new clock.
- Tile periods: `min(28, floor((now - production_at) / 21600))`. Retain fractional time. Before construction, settle then restart the tile clock to prevent retroactive bonuses.
- Rank score: `10 × territory_count + cumulative_resource_production`. Show territory count and production rate separately. Hourly snapshots display their timestamp.
- New seasons create new region/territory rows. Accounts/history survive; joining grants fresh seasonal inventory. Expired seasons reject commands. No destructive automated reset.
- Combat, land transfer and payments are disabled. Territory is a fictional seasonal game permission. Money never buys energy, power or expansion reach.
