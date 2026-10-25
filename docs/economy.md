# Economy v1

All quantities are integers. Starter grant: 100 Gold, 12 food, 12 wood, 12 iron and one free tile. Each tile produces 2 resources and 1 Gold per complete six-hour period. Meadow produces food; forest wood; mountain iron. One matching facility adds 2 resources/period and costs 20 Gold, 8 wood, 4 iron.

Each tile has its own production clock. Newly acquired land and new facilities never earn retroactively. At most 28 periods (seven days) accumulate; excess idle production is discarded. Energy regenerates separately at one per six hours to a cap of four.

Sell orders escrow full lots. A purchase fills the full lot at its integer unit price. Buyer pays `quantity × price`; seller receives that less `ceil(total × 3 / 100)` tax, recorded and burned. Cancellation returns escrow once. No self-buy, partial fills, land/cosmetic/Gems trading or NPC resource buyer. Conservation includes player inventory plus open escrow. Gold/resource ledgers are append-only and reconcile to materialized balances.

Sources: starting grants and production. Sinks: facilities and tax. Inspect issuance/concentration before adjusting rates. Test players are marked separately.

Gems remain inactive. The display-only $1/100, $10/1,100 and $100/12,000 packs are proposals. There is no purchase, transfer, conversion or grant endpoint. Cosmetic entitlement/payment/refund ledgers require separate implementation and review.
