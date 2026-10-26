# Rules v1

- Territory is permanent (land ownership v2, migration 0011). The active season ends at `9999-12-31T23:59:59Z` and is never rotated; seasons remain only as the record key for rankings and history. Commands still require active status and `begins_at <= now < ends_at`, so an operator can still close a world. Isolated pilots can use 7- or 30-day seasons.
- Every point on Earth is a plot: a Web Mercator zoom-17 tile (about 240 m in Korea, 306 m at the equator), grouped into zoom-14 regions `z14:x:y` of 8×8 plots (migration 0012). Rows are allocated only when a region is first settled or claimed. There are no preset cities. IDs are `(season, region, x, y)` with global `(gx, gy)`; they are game locations, not real parcels.
- Joining settles the chosen open plot (`territory_id`) atomically with the grant, or the first open starter plot of the region. A taken or mismatched plot returns `TERRITORY_UNAVAILABLE`; a region without starters returns `REGION_FULL`. No partial grant either way.
- A claim requires unowned land and a same-owner orthogonal neighbor in the same season. Plot-grid neighbours are global, so territory grows across region edges and allocates the next region on demand. Cost: one energy and the plot's land price in Gold ([economy](economy.md#land-price)). Water and diagonal-only neighbors are invalid.
- Version 1 world-tile regions (`earth2:*`, pilot cities) are archived: existing ownership and history remain, new settlement and claims there are rejected.
- `energy = min(4, stored + floor((now - updated_at) / 21600))`. Preserve fractional recovery unless capped; spending from full starts a new clock.
- Tile periods: `min(28, floor((now - production_at) / 21600))`. Retain fractional time. Before construction, settle then restart the tile clock to prevent retroactive bonuses.
- Rank score: `10 × territory_count + cumulative_resource_production`. Show territory count and production rate separately. Hourly snapshots display their timestamp.
- Pilot seasons create new region/territory rows. Accounts/history survive; joining grants fresh seasonal inventory. Expired seasons reject commands. No destructive automated reset.
- Combat, land transfer and payments are disabled. Territory is a permanent fictional game record. Money never buys energy, power or expansion reach.
