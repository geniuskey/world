# Adaptive world tiles (overview only)

Since land ownership v2 (migration 0012), settlement uses the zoom-17 plot grid described in [map data](map-data.md#plot-grid). World tiles below are the zoomed-out overview layer only. Version 1 regions created from them are archived, and subdivision (`WORLD_AUTO_SPLIT_ENABLED`) no longer routes settlement. The rest of this page describes the version 1 design.

Earth starts with **1,048,576 logical tiles**, arranged as 1,024 longitude columns × 1,024 latitude rows. The rectangles cover all longitudes and latitudes, including ocean and polar zones. They are game zones, not national boundaries or equal-area parcels. Ocean zones may contain fictional productive game terrain.

Roots are computed from integer coordinates in constant time; browsing never inserts a million rows. Only a first settlement and actual subdivisions create records. `shared/worldGrid.ts` defines the grid dimensions and stable paths. IDs use `earth2:x:y`, with `:0` through `:3` for southwest, southeast, northwest and northeast children. The versioned prefix preserves the earlier coarse-grid `earth:` IDs, geographic bounds, assets and history.

`GET /api/world/tiles?bbox=west,south,east,north` returns at most 2,048 display cells. Far views group roots in powers of two; grouped cells have `overview:` IDs and cannot be settled as a group. Zooming requests individual roots and persisted subdivisions within the viewport. Clicks resolve the actual geographic position to an individual root or a visible child. Date-line crossings are split into two geographic ranges. The API supplies `total_tiles` independently of the display cell count; each subdivision increases the leaf count by three.

`GET /api/regions` is bounded to 128 established settlements. It does not list virtual roots. `GET /api/regions/:id` opens a specific saved or virtual root. Coordinates and map clicks provide navigation without a million-option selector. Chunk and territory detail endpoints can preview an unallocated root without writing rows; a first join atomically materializes 64 deterministic local plots.

Settlement zones route players to local grids around their centers. Local plots retain their approximately 250 m size, rather than stretching 64 plots over the entire zone. Existing plots keep their IDs, facilities, ownership, production and balances. The local Mercator map has limited polar coverage even though the logical grid covers both poles.

**Automatic subdivision is disabled by default**, pending a decision on capacity policy. `WORLD_AUTO_SPLIT_ENABLED=true` enables the existing policy; `WORLD_SPLIT_PLAYERS` currently retains the earlier experimental threshold of eight distinct owners, and `WORLD_MAX_LEVEL` caps depth at six. That threshold is not a finalized game rule. Existing subdivided trees still route new arrivals into children while new automatic subdivision is disabled. At the depth limit, a local grid eventually runs out of its sixteen starting sites.

With subdivision enabled, populated settlements create four children in an atomic D1 batch. The parent remains available for its existing players to claim adjacent plots and build. New arrivals selecting the parent descend into the child subtree with the fewest settlers, with stable ID ordering for ties. The parent settlement's assets are not multiplied or moved. Concurrent arrivals may briefly exceed the threshold; starter assignment remains transactional.

The map renders viewport cells in native MapLibre layers. A local Natural Earth land outline provides geographic context even when the external detail service is unavailable. The game overlay starts on `style.load`, without waiting for external detail tiles. Vite uses separate dependency caches for development and browser tests, preventing a test server from replacing the optimized module metadata used by the running development server. Worker builds use ES modules.

Validation covers root coverage and coordinate lookup, bounded overview/detail views, date-line crossing, input validation, virtual previews with zero rows, subdivision and stale parent routing, concurrent starters, save preservation, browser exploration/settlement on desktop and mobile, and operation with the external basemap blocked.

## Global-only settlement

No cities are preselected or pinned. New players choose a world cell directly on the map; authentication uses that choice and has no default region or city dropdown. Region navigation lists allocated world cells, not featured locations. New-season generation inserts only the season. Migration 0010 archives the earlier three pilot regions without deleting accounts, assets, ledgers or historic territory IDs. New settlement in those pilot IDs is rejected.
