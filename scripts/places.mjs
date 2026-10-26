import { build } from 'esbuild';
import { mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Rasterize official administrative areas into per-world-tile lookup chunks.
// Lookups are by coordinate, so they do not depend on the settlement grid layout.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const country = option('--country', 'KOR').toUpperCase();
if (country !== 'KOR') throw Error('Only --country KOR is supported so far.');
// Statistics Korea (SGIS) 2018 boundaries, KOGL Type 1, via southkorea-maps at a pinned commit.
const commit = '60c8c0cf0016381d80004d6b125760d6c5cb0605';
const base = `https://raw.githubusercontent.com/southkorea/southkorea-maps/${commit}/kostat/2018/json`;
const files = {
  areas: 'skorea-submunicipalities-2018-geo.json',
  districts: 'skorea-municipalities-2018-topo.json',
  provinces: 'skorea-provinces-2018-topo.json',
};
// Cells per world-tile side: about 240 m east-west and 150 m north-south at Korean latitudes.
const CELLS = 128;
const output = 'public/places/kor';

const cache = option('--source', '.wrangler/places/kostat-2018');
await mkdir(cache, { recursive: true });
const load = async (name) => {
  const path = `${cache}/${name}`;
  try {
    await access(path);
  } catch {
    console.log(`Downloading ${base}/${name}`);
    const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw Error(`Download failed: ${name} ${response.status}`);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return JSON.parse(await readFile(path, 'utf8'));
};
const topoProperties = (topo) => Object.values(topo.objects)[0].geometries.map((g) => g.properties);

await build({
  entryPoints: ['shared/worldGrid.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.wrangler/places-grid.mjs',
});
const { rootTile, rootTileAt } = await import(
  pathToFileURL(`${process.cwd()}/.wrangler/places-grid.mjs`)
);

const areaSource = await load(files.areas);
if (areaSource.crs?.properties?.name !== 'urn:ogc:def:crs:OGC:1.3:CRS84')
  throw Error('Expected WGS84 (CRS84) longitude/latitude boundaries.');
const provinces = topoProperties(await load(files.provinces))
  .map((p) => [p.code, p.name, p.name_eng])
  .sort((a, b) => a[0].localeCompare(b[0]));
const districts = topoProperties(await load(files.districts))
  .map((p) => [p.code, p.name, p.name_eng])
  .sort((a, b) => a[0].localeCompare(b[0]));
const features = areaSource.features
  .filter((f) => f.geometry && /^\d{7}$/.test(f.properties.code))
  .sort((a, b) => a.properties.code.localeCompare(b.properties.code));
for (const f of features)
  if (!districts.some((d) => d[0] === f.properties.code.slice(0, 5)))
    throw Error(`Area ${f.properties.code} has no district`);

// Global raster aligned to world-tile boundaries.
let west = Infinity,
  east = -Infinity,
  south = Infinity,
  north = -Infinity;
const edges = [];
features.forEach((feature, index) => {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const ring of polygons.flat())
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      west = Math.min(west, x1);
      east = Math.max(east, x1);
      south = Math.min(south, y1);
      north = Math.max(north, y1);
      if (y1 !== y2) edges.push([index, x1, y1, x2, y2]);
    }
});
const first = rootTileAt(west, south),
  last = rootTileAt(east, north);
const [x0, x1] = [Number(first.id.split(':')[1]), Number(last.id.split(':')[1])];
const [y0, y1] = [Number(first.id.split(':')[2]), Number(last.id.split(':')[2])];
const tileWidth = first.east - first.west,
  tileHeight = first.north - first.south;
const columns = (x1 - x0 + 1) * CELLS,
  rows = (y1 - y0 + 1) * CELLS;
const originWest = first.west,
  originNorth = rootTile(x0, y1).north;
const rowLatitude = (row) => originNorth - ((row + 0.5) * tileHeight) / CELLS;
const raster = new Int16Array(columns * rows).fill(-1);

// Even-odd scanline fill at cell centres; holes and multipolygons follow naturally.
const buckets = Array.from({ length: rows }, () => []);
for (const edge of edges) {
  const [, , ya, , yb] = edge;
  const top = Math.max(ya, yb),
    bottom = Math.min(ya, yb);
  const r0 = Math.max(0, Math.ceil(((originNorth - top) * CELLS) / tileHeight - 0.5));
  const r1 = Math.min(rows - 1, Math.floor(((originNorth - bottom) * CELLS) / tileHeight - 0.5));
  for (let r = r0; r <= r1; r++) buckets[r].push(edge);
}
for (let r = 0; r < rows; r++) {
  const latitude = rowLatitude(r);
  const crossings = new Map();
  for (const [index, xa, ya, xb, yb] of buckets[r]) {
    if (!(Math.min(ya, yb) <= latitude && latitude < Math.max(ya, yb))) continue;
    const x = xa + ((latitude - ya) * (xb - xa)) / (yb - ya);
    if (!crossings.has(index)) crossings.set(index, []);
    crossings.get(index).push(x);
  }
  for (const [index, xs] of crossings) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil(((xs[i] - originWest) * CELLS) / tileWidth - 0.5));
      const c1 = Math.min(
        columns - 1,
        Math.ceil(((xs[i + 1] - originWest) * CELLS) / tileWidth - 0.5) - 1,
      );
      for (let c = c0; c <= c1; c++) raster[r * columns + c] = index;
    }
  }
}

// A label point inside each area: the filled cell nearest the mean of its cells.
const sums = features.map(() => [0, 0, 0]);
for (let i = 0; i < raster.length; i++)
  if (raster[i] >= 0) {
    const s = sums[raster[i]];
    s[0] += i % columns;
    s[1] += Math.floor(i / columns);
    s[2]++;
  }
const labels = features.map(() => [Infinity, 0, 0]);
for (let i = 0; i < raster.length; i++) {
  const index = raster[i];
  if (index < 0) continue;
  const [sx, sy, n] = sums[index];
  const c = i % columns,
    r = Math.floor(i / columns);
  const distance = (c - sx / n) ** 2 + (r - sy / n) ** 2;
  if (distance < labels[index][0]) labels[index] = [distance, c, r];
}
const round = (value) => Math.round(value * 1e5) / 1e5;
const areas = features.map((f, i) => {
  const [, c, r] = labels[i];
  const point =
    labels[i][0] === Infinity
      ? null
      : [round(originWest + ((c + 0.5) * tileWidth) / CELLS), round(rowLatitude(r))];
  return [f.properties.code, f.properties.name, f.properties.name_eng, ...(point ?? [null, null])];
});
const unlabelled = areas.filter((a) => a[3] === null).map((a) => a[0]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const roots = [];
for (let ty = y1; ty >= y0; ty--)
  for (let tx = x0; tx <= x1; tx++) {
    const rowOffset = (y1 - ty) * CELLS,
      colOffset = (tx - x0) * CELLS;
    const encoded = [];
    let filled = false;
    for (let r = 0; r < CELLS; r++) {
      // Run-length pairs [area index or -1, count], north to south, west to east.
      const runs = [];
      for (let c = 0; c < CELLS; c++) {
        const value = raster[(rowOffset + r) * columns + colOffset + c];
        if (value >= 0) filled = true;
        if (runs.length && runs[runs.length - 2] === value) runs[runs.length - 1]++;
        else runs.push(value, 1);
      }
      encoded.push(runs);
    }
    if (!filled) continue;
    roots.push(`${tx}:${ty}`);
    await writeFile(`${output}/${tx}-${ty}.json`, JSON.stringify({ v: 1, rows: encoded }));
  }
await writeFile(
  `${output}/index.json`,
  JSON.stringify({
    v: 1,
    country,
    cells: CELLS,
    year: 2018,
    source: 'Statistics Korea (SGIS) administrative boundaries, 2018',
    source_url: `https://github.com/southkorea/southkorea-maps/tree/${commit}/kostat/2018/json`,
    license: 'Korea Open Government License Type 1 (source attribution)',
    bbox: [round(west), round(south), round(east), round(north)],
    provinces,
    districts,
    areas,
    roots: roots.sort(),
  }),
);
console.log(
  `${features.length} areas, ${districts.length} districts, ${provinces.length} provinces; ${roots.length} world-tile chunks written to ${output}.` +
    (unlabelled.length
      ? ` Areas smaller than one cell (no label point): ${unlabelled.join(', ')}`
      : ''),
);
