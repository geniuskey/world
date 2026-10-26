# Map data

The interactive map uses MapLibre GL JS with a custom, muted vector basemap served by OpenFreeMap using OpenStreetMap data. Users can explore the whole world, recognize coastlines, lakes, major rivers, administrative boundaries, highways, railways and place names from countries down to neighbourhoods and villages, and switch between Mercator (2D map) and globe (3D Earth) projections. Every location uses the same global grid. Selecting a world cell opens a local settlement grid; plots are allocated on first settlement. No city receives a preset pin, starter menu entry or special region configuration.

## Geographic grid v1

Each selected world cell anchors an on-demand 8×8 local settlement grid. Cells run east along x and south along y, aligned in Web Mercator, scaled to approximately 250 m per cell at the region's center latitude. Archived pilot plots retain their IDs, ownership and history but are excluded from new settlement. `shared/geography.ts` is the shared forward/inverse mapping. The selected tile shows its center coordinates and an OpenStreetMap link.

This is a geographic reference for game territory, not a surveyed or cadastral boundary. Resource terrain (meadow, forest, mountain, water) is the existing deterministic game data; it does not describe real land cover. A game water cell and a real river may differ. Neither the map nor the overlay confers real property rights. Changing geographic grid v1 later requires an explicit version/migration decision so owned territory does not silently move.

The backdrop uses muted land/water colors, warm highway lines and dashed railways. Province, district and local administrative boundaries and progressively smaller place names appear as users zoom in. Regional views start at zoom 14, where the default tile service supplies Korean district and neighbourhood names. Local names remain visible at territory scale; language-specific names fall back to the original local name. Coverage of Korean 시·도, 구, 동 and villages follows the OpenStreetMap features available in the vector tiles, so missing names or boundaries are not inferred. Buildings and businesses are omitted. The regional reference grid repeats across the entire viewport, aligned with the selected settlement, and follows panning and zooming beyond its 8×8 footprint. These extended lines do not allocate additional territories. At low zoom, grid lines are grouped to stay legible. World and unoccupied settlement grids appear within a softly fading 160 px radius of the pointer and disappear on pointer exit or touch release. Selected and owned settlement plots remain visible, and keyboard focus reveals individual plots. `src/mapStyle.ts` defines the local style; 2D/globe switching and geographic territory coordinates are preserved.

## Exploration tools

The collapsible **Map tools** panel supports region-name/code search, saved places, resource distribution, population heatmaps, ownership boundaries, game landmarks, recent activity and distance measurement. Search runs in a Web Worker across all logical root regions and returns at most 16 matches. Full region names include a stable coordinate code; subdivision codes are checked against the server before navigation. Bookmarks (up to 100) and layer choices persist in this browser, independently of login.

Resource overlays use the actual game terrain and production multiplier; they do not infer physical mineral or forest coverage. Population heatmaps use only imported plot estimates from `/api/map/population`; absent estimates remain unknown, and zero is a known observation. The color scale is relative to the current region. Game landmarks are deterministic points on matching game terrain (peak, lake, grove and ruins); they are fictional and grant no resources or ownership. Selecting one focuses and inspects its plot.

The public `/api/map/activity` endpoint returns at most 30 current-season settlement, claim and construction events, optionally scoped to a region. It exposes display names, event times and plot locations, omitting action payloads and filtering blocked accounts. The panel and markers refresh every 30 seconds while active and visible. Migration `0010_map_activity.sql` adds indexes for this view.

Measurement mode consumes map clicks without selecting plots or navigating. Two points show great-circle distance and initial bearing, with a sampled path that crosses the date line continuously. A third click starts another measurement; Clear resets the points and Escape exits. This is an approximate distance on a spherical Earth, rather than a route along roads.

## Service and attribution

The default vector TileJSON source is `https://tiles.openfreemap.org/planet`, with glyphs from the same host. Attribution for [OpenFreeMap](https://openfreemap.org), [OpenMapTiles](https://openmaptiles.org) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) is always visible. See the [OpenFreeMap guide](https://openfreemap.org/quick_start/) for hosting information. Browser tests serve fixture metadata and empty vector tiles instead of contacting the public service. Network access and WebGL are required; failures offer retry.

`VITE_MAP_SOURCE_URL` selects another OpenMapTiles-compatible TileJSON source at build time. Update the displayed attribution, glyph URL and any hosting CSP allowlist when switching providers.

The former static `public/world.svg` is retained as a legacy asset, generated by `scripts/map.mjs` from public-domain Natural Earth 1:110m land. It is no longer the interactive map.

## Local fallback and world grid

The world starts with 1,048,576 logical tiles. Viewport requests and overview grouping bound the number of rendered cells; zoom in to see individual boundaries. The displayed grid is game data. Local Natural Earth land polygons in `public/land.geojson` provide a basemap independently of the external detail tile service. `scripts/map.mjs` regenerates both the SVG and GeoJSON assets. Natural Earth data is public domain. The map starts the game overlay on style initialization, so an unavailable external source does not leave an empty loading screen. See [adaptive world tiles](world-tiles.md).

## Population estimates

Population comes from [WorldPop Global 2000–2020, 1 km, UN adjusted](https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/2020/), credited to WorldPop, University of Southampton ([data use and licensing](https://www.worldpop.org/sdi/terms/)). These are historical modelled population counts, not current census counts or live location data. Selected plots display the year, 1 km source resolution and a link to the source raster.

The importer integrates raster counts over the actual approximately 250 m game-plot footprint. Boundary pixels contribute their overlapping spherical area fraction; this assumes uniform distribution inside each source pixel. A 1 km raster cannot identify the true population of an individual 250 m plot. No-data pixels cause the plot to be skipped rather than converted to a zero population. City/country totals are never distributed over a region. Population outside the selected source raster is rejected. Game water remains unclaimable and is not imported, even where game terrain differs from real geography.

With the local development server running, migrate and import explicitly:

```sh
npm run db:migrate
npm run population:import -- --region earth2:873:725 --country KOR --apply
# A selected global region can also be imported using its ID and the covering ISO3 country.
# To review SQL without changing the local DB, omit --apply.
# To use an already downloaded copy of the same source raster, add --raster /path/to/file.tif.
```

Imports target only the local DB, cache rasters under ignored `.wrangler/population`, and leave existing snapshots intact. Larger countries can require substantial downloads; if necessary download the raster separately and use `--raster`. Production rollout requires applying the population migration and separately loading reviewed snapshots; the tool does not write remotely.
