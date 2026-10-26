# Economy v1

All quantities are integers. Starter grant: 100 Gold, 12 food, 12 wood, 12 iron and one free tile. Each tile produces 2 resources and 1 Gold per complete six-hour period. Meadow produces food; forest wood; mountain iron. One matching facility adds 2 resources/period and costs 20 Gold, 8 wood, 4 iron.

## Land price

A claim costs one energy plus the plot's market price in Gold: ten turns of the plot's own Gold income, `10 × (1 + floor(population / 100))` (`shared/game.ts` `plotPrice`, migration 0013). An unpopulated or unimported plot costs 10 Gold; a plot with 950 imported residents costs 100. The Gold is burned, so claims are a sink alongside facilities and tax. The starter plot from joining stays free. The claim result and the territory detail report `price_gold`; a short balance fails with `INSUFFICIENT_FUNDS` and changes nothing. Every plot pays back its price in 2.5 days of its own income, so dense plots cost more without earning faster relative to their price. Demand from land trades (see [land ownership v2](land-ownership.md)) is not applied yet.

Each tile has its own production clock. Newly acquired land and new facilities never earn retroactively. At most 28 periods (seven days) accumulate; excess idle production is discarded. Energy regenerates separately at one per six hours to a cap of four.

Sell orders escrow full lots. A purchase fills the full lot at its integer unit price. Buyer pays `quantity × price`; seller receives that less `ceil(total × 3 / 100)` tax, recorded and burned. Cancellation returns escrow once. No self-buy, partial fills, land/cosmetic/Gems trading or NPC resource buyer. Conservation includes player inventory plus open escrow. Gold/resource ledgers are append-only and reconcile to materialized balances.

Sources: starting grants and production. Sinks: facilities and tax. Inspect issuance/concentration before adjusting rates. Test players are marked separately.

Gems remain inactive. The display-only $1/100, $10/1,100 and $100/12,000 packs are proposals. There is no purchase, transfer, conversion or grant endpoint. Cosmetic entitlement/payment/refund ledgers require separate implementation and review.

## Population income

Imported plot estimates add `floor(population / 100)` Gold per complete six-hour turn to the existing 1 Gold base income. Resource production remains available for construction and trading. Income uses each plot separately, so the account total sums the rounded plot rates. Population is fractional source data; the display rounds residents to the nearest person. Missing data is distinct from a measured zero and provides no population bonus.

`territory_population` stores the year, source raster URL, exact plot GeoJSON footprint and effective timestamp. Snapshots are inserted once for each season-specific plot ID; repeated imports do not change a running season's rate. Population income cannot predate its snapshot, ownership or the plot production clock. The existing atomic settlement trigger writes base and population income together into the Gold ledger, retains partial base-production time, and caps both at 28 turns. Snapshot activation begins with complete production periods after import; a partial first period earns only base production.

This is an initial population-based economy alongside the existing construction-resource system. Population estimates are geographic reference data, not player accounts or simulated citizens that players buy or move. Global coverage is incremental; unimported plots remain explicitly unknown.
