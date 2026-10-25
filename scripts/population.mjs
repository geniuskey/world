import { fromFile } from 'geotiff';
import { build } from 'esbuild';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Import exact 250 m plot footprints from WorldPop's WGS84 population-count raster.
// Fixed local DB destination: this command never modifies a remote database.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const regionId = option('--region');
if (!regionId || !regionId.startsWith('earth2:'))
  throw Error('Specify a world tile: --region earth2:x:y --country ISO3');
const country = option('--country', '').toUpperCase();
const year = Number(option('--year', '2020'));
if (!/^[A-Z]{3}$/.test(country) || !Number.isInteger(year) || year < 2000 || year > 2020)
  throw Error('WorldPop Global 2000–2020 requires --country ISO3 and --year 2000–2020.');
const source = `https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/${year}/${country}/${country.toLowerCase()}_ppp_${year}_1km_Aggregated_UNadj.tif`;
const api = 'http://127.0.0.1:5174/api';
const get = async (path) => {
  const response = await fetch(`${api}${path}`);
  if (!response.ok) throw Error(`Local API ${path}: ${response.status}. Start npm run dev first.`);
  return response.json();
};
await mkdir('.wrangler', { recursive: true });
await build({
  entryPoints: ['shared/geography.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.wrangler/population-geography.mjs',
});
const { gridPoint } = await import(
  pathToFileURL(`${process.cwd()}/.wrangler/population-geography.mjs`)
);
const { region } = await get(`/regions/${encodeURIComponent(regionId)}`);
const plots = [];
for (let cy = 0; cy < Math.ceil(region.height / 8); cy++)
  for (let cx = 0; cx < Math.ceil(region.width / 8); cx++)
    plots.push(
      ...(await get(`/map/chunks?region=${encodeURIComponent(regionId)}&cx=${cx}&cy=${cy}`)).tiles,
    );
const raster = option('--raster');
console.log(`Reading ${raster || source}`);
const cache = `.wrangler/population/${country}-${year}-1km.tif`;
if (!raster) {
  await mkdir('.wrangler/population', { recursive: true });
  try {
    await access(cache);
  } catch {
    const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw Error(`WorldPop download failed: ${response.status}`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length < 8 || buffer[0] !== 73 || buffer[1] !== 73)
      throw Error('WorldPop response was not a little-endian GeoTIFF.');
    await writeFile(cache, buffer);
  }
}
const tiff = await fromFile(raster || cache);
try {
  const image = await tiff.getImage();
  const keys = image.getGeoKeys();
  const [originX, originY] = image.getOrigin();
  const [stepX, stepY] = image.getResolution();
  const box = image.getBoundingBox();
  if (keys.GeographicTypeGeoKey !== 4326 || keys.ProjectedCSTypeGeoKey || stepX <= 0 || stepY >= 0)
    throw Error('Expected a north-up WGS84 WorldPop population-count raster.');
  const nodata = image.getGDALNoData();
  // Read one regional window, avoiding hundreds of repeated network requests.
  const [west, north] = gridPoint(region, 0, 0);
  const [east, south] = gridPoint(region, region.width, region.height);
  if (west < box[0] || south < box[1] || east > box[2] || north > box[3])
    throw Error('Region crosses the raster extent; use a raster covering the complete region.');
  const x0 = Math.max(0, Math.floor((west - originX) / stepX));
  const y0 = Math.max(0, Math.floor((north - originY) / stepY));
  const x1 = Math.min(image.getWidth(), Math.ceil((east - originX) / stepX));
  const y1 = Math.min(image.getHeight(), Math.ceil((south - originY) / stepY));
  const values = await image.readRasters({
    window: [x0, y0, x1, y1],
    samples: [0],
    interleave: true,
  });
  const sql = [];
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  let missing = 0;
  for (const plot of plots) {
    if (plot.terrain_type === 'water') continue;
    const [w, n] = gridPoint(region, plot.x, plot.y);
    const [e, s] = gridPoint(region, plot.x + 1, plot.y + 1);
    let sum = 0,
      complete = true;
    for (let y = Math.floor((n - originY) / stepY); y < Math.ceil((s - originY) / stepY); y++)
      for (let x = Math.floor((w - originX) / stepX); x < Math.ceil((e - originX) / stepX); x++) {
        const value = values[(y - y0) * (x1 - x0) + (x - x0)];
        if (!Number.isFinite(value) || value === nodata || value < 0) {
          complete = false;
          continue;
        }
        const px = originX + x * stepX,
          py = originY + y * stepY;
        const fractionX = Math.max(0, Math.min(e, px + stepX) - Math.max(w, px)) / stepX;
        // Spherical area fraction for the north/south edges.
        const sin = (latitude) => Math.sin((latitude * Math.PI) / 180);
        const fractionY =
          (sin(Math.min(n, py)) - sin(Math.max(s, py + stepY))) / (sin(py) - sin(py + stepY));
        sum += value * fractionX * Math.max(0, fractionY);
      }
    if (!complete) {
      missing++;
      continue;
    }
    const footprint = {
      type: 'Polygon',
      coordinates: [
        [
          [w, n],
          [e, n],
          [e, s],
          [w, s],
          [w, n],
        ],
      ],
    };
    sql.push(
      `INSERT INTO territory_population(territory_id,population,year,source,footprint_json,effective_at) VALUES(${quote(plot.id)},${sum},${year},${quote(source)},${quote(JSON.stringify(footprint))},unixepoch()) ON CONFLICT(territory_id) DO NOTHING;`,
    );
  }
  if (!sql.length)
    throw Error('No complete population footprints found. No database changes made.');
  const output = '.wrangler/population-import.sql';
  await writeFile(output, sql.join('\n'));
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
        output,
      ],
      { encoding: 'utf8' },
    );
    if (result.status !== 0)
      throw Error(`Local population import failed: ${result.stderr || result.stdout}`);
  }
  console.log(
    `${sql.length} plot estimates prepared; ${missing} plots with missing data skipped. ${args.includes('--apply') ? 'Imported into local DB.' : `Review ${output}; rerun with --apply to import locally.`}`,
  );
} finally {
  await tiff.close();
}
