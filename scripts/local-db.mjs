import { rm, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const command = process.argv[2];
const run = (args) => {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
};
if (command === 'reset') {
  // Deliberately fixed to this checkout's local database. No remote flag/path accepted.
  await rm(resolve('.wrangler/state/v3/d1'), { recursive: true, force: true });
  run(['d1', 'migrations', 'apply', 'world-local', '--local', '--env', 'local']);
  console.log('Local WORLD database reset. Restart the development server if it was running.');
} else if (command === 'demo') {
  await mkdir('.wrangler', { recursive: true });
  await build({
    stdin: {
      contents:
        "export { plotAt, plotRegion } from './shared/plots'; export { virtualTerritories } from './worker/world';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.wrangler/demo-grid.mjs',
  });
  const { plotAt, plotRegion, virtualTerritories } = await import(
    pathToFileURL(resolve('.wrangler/demo-grid.mjs'))
  );
  const sql = [];
  for (const [name, longitude, latitude, kind] of [
    ['Mira', 10, 10, 'food'],
    ['Sol', 50, 20, 'wood'],
    ['Jun', -60, -10, 'iron'],
  ]) {
    const region = plotAt(longitude, latitude).region,
      metadata = plotRegion(region, '');
    const active = "SELECT id FROM seasons WHERE status='active' AND ends_at>unixepoch()";
    sql.push(
      `INSERT OR IGNORE INTO regions(id,season_id,name,subtitle,longitude,latitude,width,height,land_count) SELECT '${region}',id,'${metadata.name}','${metadata.subtitle}',${metadata.longitude},${metadata.latitude},8,8,64 FROM seasons WHERE id IN (${active});`,
    );
    sql.push(
      `INSERT OR IGNORE INTO chunk_versions SELECT id,'${region}',0,0,1 FROM seasons WHERE id IN (${active});`,
    );
    for (const plot of virtualTerritories('', region))
      sql.push(
        `INSERT OR IGNORE INTO territories(id,region_id,season_id,x,y,gx,gy,cx,cy,terrain_type,is_starter) SELECT id||':${region}:${plot.x}:${plot.y}','${region}',id,${plot.x},${plot.y},${plot.gx},${plot.gy},0,0,'${plot.terrain_type}',${plot.is_starter} FROM seasons WHERE id IN (${active});`,
      );
    const user = `demo-world-${name.toLowerCase()}`,
      display = `World Demo ${name}`,
      subject = display.toLowerCase();
    sql.push(
      `INSERT OR IGNORE INTO users(id,auth_provider,provider_subject,created_at,is_test) VALUES('${user}','local','${subject}',unixepoch(),1);`,
    );
    sql.push(
      `INSERT OR IGNORE INTO profiles(user_id,display_name,created_at) VALUES('${user}','${display}',unixepoch());`,
    );
    sql.push(
      `INSERT INTO actions(id,user_id,season_id,type,payload_json,idempotency_key,created_at) SELECT '${user}-join-'||id,'${user}',id,'join','{"region_id":"${region}"}','join:'||id,unixepoch() FROM seasons WHERE status='active' AND ends_at>unixepoch() ON CONFLICT(user_id,idempotency_key) DO NOTHING;`,
    );
    sql.push(
      `INSERT INTO actions(id,user_id,season_id,type,payload_json,idempotency_key,created_at) SELECT '${user}-offer-'||id,'${user}',id,'sell','{"kind":"${kind}","quantity":5,"price_gold":3}','demo:offer:'||id,unixepoch() FROM seasons WHERE status='active' AND ends_at>unixepoch() AND NOT EXISTS(SELECT 1 FROM actions WHERE user_id='${user}' AND idempotency_key='demo:offer:'||seasons.id);`,
    );
  }
  await mkdir('.wrangler', { recursive: true });
  await writeFile('.wrangler/world-demo.sql', sql.join('\n'));
  run([
    'd1',
    'execute',
    'world-local',
    '--local',
    '--env',
    'local',
    '--file',
    '.wrangler/world-demo.sql',
  ]);
  console.log(
    'Created labeled World Demo Mira, World Demo Sol and World Demo Jun playtest accounts and offers.',
  );
} else throw Error('Use npm run db:reset or npm run db:demo. No remote operations are supported.');
