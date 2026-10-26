# Map data

The interactive map uses MapLibre GL JS with a custom, muted vector basemap served by OpenFreeMap using OpenStreetMap data. Users can explore the whole world, recognize coastlines, lakes, major rivers, administrative boundaries, highways, railways and place names from countries down to neighbourhoods and villages, and switch between Mercator (2D map) and globe (3D Earth) projections. Every location uses the same global grid. Selecting a world cell opens a local settlement grid; plots are allocated on first settlement. No city receives a preset pin, starter menu entry or special region configuration.

## Plot grid

Plots are standard Web Mercator zoom-17 tiles, so a plot is the same `17/x/y` tile any slippy map uses for that place: about 306 m at the equator, 240 m in Korea, and narrower towards the poles. A region is the zoom-14 tile containing an 8×8 block of plots (`z14:x:y`). `shared/plots.ts` converts coordinates to plots and back; `shared/geography.ts` routes plot regions through it. Every point on Earth up to ±85.05° latitude has a plot, IDs come from coordinates, and rows are allocated only when a region is first settled or claimed. Clicking anywhere on the map opens that plot; coordinate search opens the plot at the coordinates; place search opens the plot at an area's interior label point.

This is a geographic reference for game territory, not a surveyed or cadastral boundary. Resource terrain (meadow, forest, mountain, water) is still deterministic game data and does not describe real land cover; a game plot can sit on a real river. Neither the map nor the overlay confers real property rights. Version 1 regions (`earth2:*` world tiles with a 250 m grid around their centre) are archived; their plots keep their IDs, owners and history and still render with the version 1 grid. The world-tile overview remains a zoomed-out display only.

## Exploration tools

The collapsible **Map tools** panel supports region-name/code search, saved places, resource distribution, population heatmaps, ownership boundaries, game landmarks, recent activity and distance measurement. Search runs in a Web Worker across all logical root regions and returns at most 16 matches. Full region names include a stable coordinate code; subdivision codes are checked against the server before navigation. Bookmarks (up to 100) and layer choices persist in this browser, independently of login.

Resource overlays use the actual game terrain and production multiplier; they do not infer physical mineral or forest coverage. Population heatmaps use only imported plot estimates from `/api/map/population`; absent estimates remain unknown, and zero is a known observation. The color scale is relative to the current region. Game landmarks are deterministic points on matching game terrain (peak, lake, grove and ruins); they are fictional and grant no resources or ownership. Selecting one focuses and inspects its plot.

The public `/api/map/activity` endpoint returns at most 30 current-season settlement, claim and construction events, optionally scoped to a region. It exposes display names, event times and plot locations, omitting action payloads and filtering blocked accounts. The panel and markers refresh every 30 seconds while active and visible. Migration `0010_map_activity.sql` adds indexes for this view.

Measurement mode consumes map clicks without selecting plots or navigating. Two points show great-circle distance and initial bearing, with a sampled path that crosses the date line continuously. A third click starts another measurement; Clear resets the points and Escape exits. This is an approximate distance on a spherical Earth, rather than a route along roads.

## Place names

Plots in South Korea show their real administrative area (시·도, 시·군·구, 읍·면·동), for example `서울특별시 강남구 역삼1동`, in the plot inspector and the map popup. Names come from Statistics Korea (SGIS) 2018 administrative boundaries, provided under the [Korea Open Government License Type 1](https://www.kogl.or.kr/info/license.do) (source attribution; commercial use allowed), via [southkorea-maps](https://github.com/southkorea/southkorea-maps/tree/60c8c0cf0016381d80004d6b125760d6c5cb0605/kostat/2018/json) at a pinned commit. The inspector shows the source and license. Areas renamed or merged after 2018 keep their 2018 names. North Korea, the sea and islands smaller than a lookup cell (including Dokdo in this source) have no name.

`npm run places:build` rasterizes the boundaries once into static files under `public/places/kor`: `index.json` (names, codes, an interior label point per area and the list of covered world tiles) and one run-length encoded chunk per covered world tile (`x-y.json`, 128 × 128 cells, about 240 × 150 m). The total is 266 chunks, about 350 kB gzip; a browser loads the 67 kB gzip index and only the chunks it looks at. Lookups are by coordinate (`shared/places.ts`, `src/places.ts`), independent of the settlement grid. The build is deterministic and has no runtime API, database or external service. Source files are cached in ignored `.wrangler/places`. Validation compared the raster with direct point-in-polygon tests on the original polygons at 20,000 random cell centres and found no differences.

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
npm run population:import -- --region z14:13970:6344 --country KOR --apply
# A selected global region can also be imported using its ID and the covering ISO3 country.
# To review SQL without changing the local DB, omit --apply.
# To use an already downloaded copy of the same source raster, add --raster /path/to/file.tif.
```

Imports target only the local DB, cache rasters under ignored `.wrangler/population`, and leave existing snapshots intact. Larger countries can require substantial downloads; if necessary download the raster separately and use `--raster`. Production rollout requires applying the population migration and separately loading reviewed snapshots; the tool does not write remotely.
