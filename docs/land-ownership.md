# Land ownership v2 (proposed)

Status: design accepted 2026-10-26, not implemented. Rules v1 ([game-rules.md](game-rules.md), [economy.md](economy.md)) remain in force until migration.

## Goal

Players own a virtual copy of real places: their home, their school, a famous landmark. Meaning comes from the place, so plots carry real place names and real landmarks. Ownership is permanent and tradeable in Gold, and early arrival must not yield unbounded gains.

## Decisions

- **Permanent ownership.** Land is no longer reset by seasons. Seasons remain only for rankings and history.
- **Any plot can be sold, and any plot can be force-bought** at `market price × (1 + n)`. There are no exemptions, including the home plot. `n` defaults to 20% (`WORLD_BUYOUT_PREMIUM_PCT`).
- **First come, first served** for unowned plots and landmarks, at the current market price. Only one starter plot per account is free.
- Gold stays non-purchasable, non-withdrawable and unconnected to Gems. Land has no real-world value.

## Price

```
base value   = base × location factor (population, landmark tier) × development factor (facilities)
demand index = median(recent nearby trade price / base value), clamped to [0.5, 3.0], moving at most ±5% per day
market price = base value × demand index
buyout price = market price × (1 + n)
```

Base value comes only from imported reference data and built facilities, so players cannot set it. Demand reflects actual trades within the surrounding world tile. Use the median, require a minimum number of trades, and exclude repeated trades between the same pair of accounts.

## Why gains stay bounded

The buyout price is a hard ceiling: nobody pays more than they could force. An owner who enters at the lowest demand index (0.5) and exits at the highest forced price (3.0 × 1.2) gains at most about 7.2×. Realized gains also pay a progressive transfer tax that is burned (proposed: 10% of profit up to 2×, 30% above that). First claims cost the market price, so early arrivals pay fair value. Earth 2-style windfalls come from a flat launch price, which this design does not have.

## Transactions

| Action | Rule |
|---|---|
| First claim | Pay the market price; first come, first served; one free starter plot |
| Listing | Owner asks any price at or below the buyout price; escrowed like resource orders |
| Forced buyout | Pay the buyout price; the owner receives it plus facility build cost, minus transfer tax, and is notified |
| Protection | No forced buyout within 7 days of any acquisition |
| Cooldown | The same buyer cannot force-buy from the same owner again for 7 days |

Former and first owners stay in a permanent public history ("first settler of …"). Losing a plot keeps the record and pays the premium, but grants no economic protection.

## Abuse cases

- **Wash trading to inflate demand:** median, minimum trade count, daily movement cap, same-pair exclusion.
- **Buyout harassment:** protection period, per-pair cooldown, and the premium goes to the displaced owner.
- **Cash-out:** no Gold withdrawal, conversion or Gems link; reports and ledgers stay append-only.

## Implementation order

1. Detach territory ownership from `season_id`; store a reverse-geocoded place name per plot on first claim; replace generated terrain and fictional landmarks with OSM land use and points of interest.
2. Base value, market price, paid first claims, free starter plot.
3. Listings and forced buyout on the existing escrow and ledger triggers; protection, cooldown, transfer tax.
4. Owner names on the map, owner profiles, ownership history, share cards.

Open parameters: `n`, the demand clamp, the tax brackets, the protection length and the base price scale. Tune them with simulation before launch.
