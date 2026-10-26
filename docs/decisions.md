# Decisions

1. Keep the requested stack in this checkout; prepare Cloudflare deployment without provisioning external services.
2. Deliver Phase 1 plus resource trading. Combat, land transfers, payments and growth features stay deferred/off.
3. Google OIDC avoids an outbound mail service and uses verified provider identity. Tradeoff: Google account required. Loopback-only local login supports credential-free development and is never a production fallback.
4. SQLite command triggers provide D1 atomicity without a coordination server; integration tests exercise actual workerd/D1.
5. A global grid with on-demand 8×8 settlement regions and 8×8 chunks; no preset cities. The original three pilot regions are archived, preserving existing account assets and history. MapLibre provides a worldwide OpenStreetMap basemap and 2D/globe switching. Geographic grid v1 anchors cells at approximately 250 m to each region center; existing generated resource terrain is game data, unrelated to actual parcels. See map-data.md.
6. One facility level, seven-day production cap, whole-lot trades, rounded-up 3% tax. These reversible rules are published in the UI/docs.
7. First-party daily aggregate metrics/account visits; no persistent anonymous identity or third-party analytics. Test accounts marked.
8. Expiry blocks writes and preserves history. An operator script initializes a new season; no destructive automatic reset.
9. Local development uses ports 5174/8788 to avoid other applications already running in this workspace environment. Browser tests use separate ports 5175/8789 and isolated D1 persistence.
10. The Miniflare version is pinned to Wrangler's current runtime dependency. Tests use its supplied v4 configuration converter. Undici is overridden to the patched 7.30.1+ series; the installed dependency audit reports no known vulnerabilities.
11. Account achievements are permanent records. Old-season open orders remain historical escrow; they cannot be traded or carried into the next season.
12. Land ownership v2 (proposed, see land-ownership.md): permanent ownership; every plot, including the home plot, can be sold or force-bought at market price plus a premium (default 20%); first-come claims pay the market price. Rationale: exempting any plot would give early arrivals an outsized permanent advantage.
13. Plot grid (migration 0012): plots are Web Mercator zoom-17 tiles grouped into zoom-14 regions of 8×8, so every location (a home, a school, a landmark) can be owned. It reuses the existing region/8×8 model, triggers and ledgers; global `gx`/`gy` columns let territory grow across region edges. Version 1 world-tile regions are archived rather than migrated, since only local test data used them.
