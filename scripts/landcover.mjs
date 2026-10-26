import { fromUrl } from 'geotiff';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Classify every plot in a box by its majority ESA WorldCover 2021 class and write SQL for D1.
// Reads one overview level of the public Cloud-Optimized GeoTIFFs with HTTP range requests and
// caches it under .wrangler/landcover. --apply executes the SQL on the local database only.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
// Default: South Korea, Jeju to Goseong and Dokdo.
const [west, south, east, north] = option('--bbox', '124.5,33.0,131.9,38.7').split(',').map(Number);
const set = option('--set', 'worldcover-2021-kor');
const level = Number(option('--level', '3'));
const out = option('--out', `.wrangler/landcover/${set}.sql`);
if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north)
  throw Error('Specify --bbox west,south,east,north in degrees.');
if (!/^[a-z0-9-]+$/.test(set)) throw Error('--set must be a lowercase identifier.');
if (!Number.isInteger(level) || level < 0 || level > 6) throw Error('--level must be 0–6.');

await mkdir('.wrangler/landcover', { recursive: true });
await build({
  entryPoints: ['shared/plots.ts', 'shared/landCover.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.wrangler/landcover/lib',
});
const lib = (name) => import(pathToFileURL(`${process.cwd()}/.wrangler/landcover/lib/${name}.js`));
const {
  REGION_PLOTS,
  REGION_ZOOM,
  PLOT_ZOOM,
  plotAt,
  plotRegion,
  plotRegionId,
  tileLatitude,
  tileLongitude,
} = await lib('plots');
const { LAND_COVER } = await lib('landCover');
const letter = new Map(Object.entries(LAND_COVER).map(([key, value]) => [value.code, key]));

// WorldCover is published in 3° tiles named by their south-west corner; all-sea tiles are absent.
const tileName = (lat, lon) =>
  `${lat < 0 ? 'S' : 'N'}${String(Math.abs(lat)).padStart(2, '0')}${lon < 0 ? 'W' : 'E'}${String(Math.abs(lon)).padStart(3, '0')}`;
const rasters = new Map();
async function raster(lat, lon) {
  const name = tileName(lat, lon);
  if (rasters.has(name)) return rasters.get(name);
  const cache = `.wrangler/landcover/${name}-L${level}`;
  let entry = null;
  try {
    const meta = JSON.parse(await readFile(`${cache}.json`, 'utf8'));
    entry = meta.missing ? null : { ...meta, data: new Uint8Array(await readFile(`${cache}.bin`)) };
  } catch {
    const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
    const head = await fetch(url, { method: 'HEAD' });
    if (head.status === 404 || head.status === 403) {
      console.log(`${name}: no tile (open sea)`);
      await writeFile(`${cache}.json`, JSON.stringify({ missing: true }));
    } else {
      if (!head.ok) throw Error(`${name}: ${head.status}`);
      console.log(`${name}: reading overview ${level}`);
      const tiff = await fromUrl(url);
      const image = await tiff.getImage(level);
      const [data] = await image.readRasters({ interleave: false });
      entry = { width: image.getWidth(), height: image.getHeight(), data: new Uint8Array(data) };
      await writeFile(`${cache}.bin`, entry.data);
      await writeFile(
        `${cache}.json`,
        JSON.stringify({ width: entry.width, height: entry.height }),
      );
    }
  }
  if (entry) Object.assign(entry, { west: lon, north: lat + 3 });
  rasters.set(name, entry);
  return entry;
}
const tiles = [];
for (let lat = Math.floor(south / 3) * 3; lat < north; lat += 3)
  for (let lon = Math.floor(west / 3) * 3; lon < east; lon += 3) tiles.push(await raster(lat, lon));
const sample = (longitude, latitude) => {
  const tile = rasters.get(tileName(Math.floor(latitude / 3) * 3, Math.floor(longitude / 3) * 3));
  if (!tile) return 80;
  const x = Math.min(tile.width - 1, Math.floor(((longitude - tile.west) / 3) * tile.width));
  const y = Math.min(tile.height - 1, Math.floor(((tile.north - latitude) / 3) * tile.height));
  return tile.data[y * tile.width + x] || 80;
};

// Regions whose centre lies in the box; the set's box is what the Worker treats as covered.
const SAMPLES = 4;
const first = plotAt(west, north),
  last = plotAt(east, south);
const rows = [];
const totals = {};
for (let ry = Math.floor(first.gy / REGION_PLOTS); ry <= Math.floor(last.gy / REGION_PLOTS); ry++)
  for (
    let rx = Math.floor(first.gx / REGION_PLOTS);
    rx <= Math.floor(last.gx / REGION_PLOTS);
    rx++
  ) {
    const id = plotRegionId(rx, ry);
    const centre = plotRegion(id, '');
    if (
      centre.longitude < west ||
      centre.longitude > east ||
      centre.latitude < south ||
      centre.latitude > north
    )
      continue;
    let classes = '';
    for (let y = 0; y < REGION_PLOTS; y++)
      for (let x = 0; x < REGION_PLOTS; x++) {
        const counts = new Map();
        for (let sy = 0; sy < SAMPLES; sy++)
          for (let sx = 0; sx < SAMPLES; sx++) {
            const gx = rx * REGION_PLOTS + x + (sx + 0.5) / SAMPLES,
              gy = ry * REGION_PLOTS + y + (sy + 0.5) / SAMPLES;
            const code =
              letter.get(sample(tileLongitude(gx, PLOT_ZOOM), tileLatitude(gy, PLOT_ZOOM))) ?? 'w';
            counts.set(code, (counts.get(code) ?? 0) + 1);
          }
        // Majority class; a tie never turns land into water.
        const [best] = [...counts].sort(
          (a, b) => b[1] - a[1] || (a[0] === 'w') - (b[0] === 'w'),
        )[0];
        classes += best;
        totals[best] = (totals[best] ?? 0) + 1;
      }
    if (classes !== 'w'.repeat(REGION_PLOTS ** 2)) rows.push([id, classes]);
  }
console.log(`zoom ${REGION_ZOOM} regions with land: ${rows.length}; plot classes`, totals);

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = [
  `INSERT OR REPLACE INTO land_cover_sets VALUES(${quote(set)},${west},${south},${east},${north},${quote('https://esa-worldcover.org/en/data-access')},${quote('CC BY 4.0')},2021,unixepoch());`,
  `DELETE FROM region_land_cover WHERE set_id=${quote(set)};`,
];
for (let i = 0; i < rows.length; i += 400)
  sql.push(
    `INSERT INTO region_land_cover VALUES${rows
      .slice(i, i + 400)
      .map(([id, classes]) => `(${quote(id)},${quote(set)},${quote(classes)})`)
      .join(',')};`,
  );
// Re-terrain allocated plots of covered regions. Owned plots keep their terrain (nobody loses
// land), but still record the real cover; water plots stop being starting sites.
sql.push(
  `UPDATE territories SET land_cover=COALESCE(substr((SELECT classes FROM region_land_cover c WHERE c.region_id=territories.region_id AND c.set_id=${quote(set)}),y*8+x+1,1),'w') WHERE region_id IN (SELECT r.id FROM regions r WHERE r.id LIKE 'z14:%' AND r.longitude BETWEEN ${west} AND ${east} AND r.latitude BETWEEN ${south} AND ${north});`,
  `UPDATE territories SET terrain_type=CASE land_cover ${Object.entries(LAND_COVER)
    .map(([key, value]) => `WHEN '${key}' THEN '${value.terrain}'`)
    .join(
      ' ',
    )} END,is_starter=CASE WHEN land_cover='w' THEN 0 ELSE is_starter END,version=version+1 WHERE land_cover IS NOT NULL AND owner_user_id IS NULL AND region_id IN (SELECT r.id FROM regions r WHERE r.id LIKE 'z14:%' AND r.longitude BETWEEN ${west} AND ${east} AND r.latitude BETWEEN ${south} AND ${north});`,
);
await writeFile(out, `${sql.join('\n')}\n`);
console.log(`Wrote ${out}`);
if (args.includes('--apply')) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'world-local',
      '--local',
      '--env',
      'local',
      '--file',
      out,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
