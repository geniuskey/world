# Economy v1

All quantities are integers. Starter grant: 100 Gold, 12 food, 12 wood, 12 iron and one free tile. Each tile produces 2 resources and 1 Gold per complete six-hour period. Meadow produces food; forest wood; mountain iron. One matching facility adds 2 resources/period and costs 20 Gold, 8 wood, 4 iron.

## Land price

A claim costs one energy plus the plot's market price in Gold: ten turns of the plot's own Gold income, `10 × (1 + floor(population / 100))` (`shared/game.ts` `plotPrice`, migration 0013). An unpopulated or unimported plot costs 10 Gold; a plot with 950 imported residents costs 100. The Gold is burned, so claims are a sink alongside facilities and tax. The starter plot from joining stays free. The claim result and the territory detail report `price_gold`; a short balance fails with `INSUFFICIENT_FUNDS` and changes nothing. Every plot pays back its price in 2.5 days of its own income, so dense plots cost more without earning faster relative to their price. Market price includes the region's demand index from recent land trades (see [land ownership v2](land-ownership.md#price)).

## Land trading

Owned plots trade for Gold (migration 0014, behind `LAND_TRADING_ENABLED`). Prices come from the `land_quotes` view and the single-row `land_rules` table:

- **Market price** = land price + 20 Gold if the plot has a facility.
- **Buyout price** = `ceil(market × (100 + buyout_premium_pct) / 100)`, 20% by default (a 10 Gold plot: 12 Gold).
- **Listing**: the owner asks 1 Gold up to the buyout price (`ABOVE_BUYOUT_PRICE` otherwise). One open listing per plot, at most 20 per seller. The plot keeps producing for the seller until it sells.
- **Buying** costs one energy and the price: the asking price of an open listing, otherwise the buyout price. The payload's `price_gold` is the buyer's maximum (`PRICE_CHANGED`). Forced buyouts are refused for `protection_seconds` (7 days) after any acquisition (`PROTECTED`) and for `cooldown_seconds` (7 days) after the same buyer last force-bought from the same owner (`BUYOUT_COOLDOWN`).
- **Transfer tax**, burned: with cost basis `b` (what the seller paid for the claim, purchase and facilities; 0 for the free starter plot) and gain `g = price − b`, tax = `ceil(10% × min(g, b)) + ceil(30% × max(0, g − b))` (`shared/game.ts` `landTax`). A 10 Gold plot sold at its 12 Gold buyout pays 1 Gold; a free starter plot pays 4.
- Before the plot changes hands the seller's production is settled. Every change of hands is recorded in the append-only `land_trades` ledger, with `land_purchase` and `land_sale` Gold ledger entries.

Each tile has its own production clock. Newly acquired land and new facilities never earn retroactively. At most 28 periods (seven days) accumulate; excess idle production is discarded. Energy regenerates separately at one per six hours to a cap of four.

Sell orders escrow full lots. A purchase fills the full lot at its integer unit price. Buyer pays `quantity × price`; seller receives that less `ceil(total × 3 / 100)` tax, recorded and burned. Cancellation returns escrow once. No self-buy, partial fills, cosmetic/Gems trading or NPC resource buyer. Conservation includes player inventory plus open escrow. Gold/resource ledgers are append-only and reconcile to materialized balances.

Sources: starting grants and production. Sinks: land prices, facilities, trade tax and land transfer tax. Inspect issuance/concentration before adjusting rates. Test players are marked separately.

Gems remain inactive. The display-only $1/100, $10/1,100 and $100/12,000 packs are proposals. There is no purchase, transfer, conversion or grant endpoint. Cosmetic entitlement/payment/refund ledgers require separate implementation and review.

## Population income

Imported plot estimates add `floor(population / 100)` Gold per complete six-hour turn to the existing 1 Gold base income. Resource production remains available for construction and trading. Income uses each plot separately, so the account total sums the rounded plot rates. Population is fractional source data; the display rounds residents to the nearest person. Missing data is distinct from a measured zero and provides no population bonus.

`territory_population` stores the year, source raster URL, exact plot GeoJSON footprint and effective timestamp. Snapshots are inserted once for each season-specific plot ID; repeated imports do not change a running season's rate. Population income cannot predate its snapshot, ownership or the plot production clock. The existing atomic settlement trigger writes base and population income together into the Gold ledger, retains partial base-production time, and caps both at 28 turns. Snapshot activation begins with complete production periods after import; a partial first period earns only base production.

This is an initial population-based economy alongside the existing construction-resource system. Population estimates are geographic reference data, not player accounts or simulated citizens that players buy or move. Global coverage is incremental; unimported plots remain explicitly unknown.
