import { rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';

// Only the test database is reset; development saves use .wrangler/state.
const persistence = '.wrangler/e2e';
await rm(persistence, { recursive: true, force: true });
const migration = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'migrations',
    'apply',
    'world-local',
    '--local',
    '--env',
    'local',
    '--persist-to',
    persistence,
  ],
  { stdio: 'inherit' },
);
if (migration.status !== 0) process.exit(migration.status || 1);
const child = spawn(
  process.execPath,
  [
    'node_modules/concurrently/dist/bin/concurrently.js',
    '-k',
    '-n',
    'web,api',
    'vite --host localhost --port 5175',
    `wrangler dev --env local --port 8789 --var APP_ORIGIN:http://localhost:5175 --persist-to ${persistence}`,
  ],
  { stdio: 'inherit', env: { ...process.env, WORLD_API_ORIGIN: 'http://localhost:8789' } },
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
