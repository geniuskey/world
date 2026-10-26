# Land ownership v2

Status: design accepted 2026-10-26. Permanent ownership is implemented (migration 0011): the active season never ends and is no longer rotated, so every `season_id` key and ledger trigger stays unchanged. Real place names are implemented for South Korea ([map data](map-data.md#place-names)). Every point on Earth is a claimable zoom-17 plot and players settle the plot they choose (migration 0012, [map data](map-data.md#plot-grid)). First claims pay the plot's base value as its market price (migration 0013, [economy](economy.md#land-price)): ten turns of the plot's income, so the location factor is imported population; landmark tiers, facility development and the demand index are not applied yet. Listings, purchases and forced buyouts with protection, the per-pair cooldown and the transfer tax are implemented (migration 0014, [economy](economy.md#land-trading)) behind `LAND_TRADING_ENABLED`, which is on locally and off in production until the parameters are tuned. Real land cover replaces generated terrain in South Korea (migration 0016, [map data](map-data.md#land-cover)), so rivers and the sea cannot be owned; fictional landmarks are not yet replaced by real points of interest. Owner names on the map, public owner profiles, the per-plot record and owner notices are implemented (migration 0015, see [Records](#records)). The demand index is not applied yet, so market price is still base value; the rest of rules v1 ([game-rules.md](game-rules.md), [economy.md](economy.md)) remains in force.

## Goal

Players own a virtual copy of real places: their home, their school, a famous landmark. Meaning comes from the place, so plots carry real place names and real landmarks. Ownership is permanent and tradeable in Gold, and early arrival must not yield unbounded gains.

## Decisions

- **Permanent ownership.** Land is no longer reset by seasons. Seasons remain only for rankings and history.
- **Any plot can be sold, and any plot can be force-bought** at `market price × (1 + n)`. There are no exemptions, including the home plot. `n` defaults to 20% (`land_rules.buyout_premium_pct`).
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

The buyout price is a hard ceiling: nobody pays more than they could force. An owner who enters at the lowest demand index (0.5) and exits at the highest forced price (3.0 × 1.2) gains at most about 7.2×. Realized gains also pay a progressive transfer tax that is burned: 10% of the gain up to the cost basis (a 2× sale), 30% of the gain above it. First claims cost the market price, so early arrivals pay fair value. Earth 2-style windfalls come from a flat launch price, which this design does not have.

## Transactions

| Action        | Rule                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| First claim   | Pay the market price; first come, first served; one free starter plot                                  |
| Listing       | Owner asks any price at or below the buyout price; the plot stays with the owner until it sells        |
| Forced buyout | Pay the buyout price; facility build cost is part of the market price; the owner receives it minus tax |
| Protection    | No forced buyout within 7 days of any acquisition                                                      |
| Cooldown      | The same buyer cannot force-buy from the same owner again for 7 days                                   |

Buying costs one energy plus the price and, unlike a claim, needs no adjacent plot. A buy fills an open listing if there is one, otherwise it is a forced buyout; the buyer states the most they will pay, so a price change fails with `PRICE_CHANGED` instead of charging more. A player who loses every plot may claim any open plot to start again.

Former and first owners stay in a permanent public history ("first settler of …"). Losing a plot keeps the record and pays the premium, but grants no economic protection.

## Records

- **Map:** at zoom 15 and above, with the ownership layer on, owned plots show their owner's name (`owner_name` in `/api/map/chunks`; blocked accounts show none).
- **Plot record:** `GET /api/territories/:id/history` returns the first settler and the last 20 events (settlement, claim, facility, purchase or buyout with price and previous owner), read from `actions` and `land_trades`. Plots never return to the commons, so the first join or claim is the first settler forever.
- **Profiles:** `GET /api/players/:id` lists an active player's plots, first-settlement count and recent land trades; `/player/:id` renders it, linked from owner names and the leaderboard.
- **Notices:** `GET /api/me/notifications` lists land sold or force-bought away since `profiles.land_seen_at`; `POST /api/me/notifications/seen` dismisses them. The app shows them as a banner until dismissed.
- **Share cards:** the Worker serves `/territory/:id` with a title naming the owner and the real place (`og:title`, `og:description`), and the inspector's Share button uses the system share sheet or copies the link. There is no preview image yet.

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
