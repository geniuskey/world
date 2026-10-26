import { worldTileFromId } from '../shared/worldGrid';
import { plotAt, plotRegionId, plotTerritoryId, regionFor } from '../shared/plots';
import { gridPoint } from '../shared/geography';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import {
  isPermanent,
  PERMANENT_ENDS_AT,
  recoverEnergy,
  tradeTax,
  TURN_SECONDS,
  type PlayerState,
  type Territory,
} from '../shared/game';

let mf: Miniflare, db: D1Database;
let counter = 0;
const origin = 'http://localhost:5174';
const uuid = () => crypto.randomUUID();
type Actor = { cookie: string; id: string; state: PlayerState };
async function request(
  path: string,
  body?: unknown,
  cookie = '',
  options: { origin?: string; headers?: Record<string, string>; host?: string } = {},
) {
  const response = await mf.dispatchFetch(`${options.host || 'http://localhost:8787'}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json', Origin: options.origin || origin }),
      'cf-connecting-ip': `127.0.${++counter % 250}.1`,
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}
async function actor(
  name = `Settler ${++counter}`,
  region = 'earth2:800:600:0:0:0:0:0:0',
): Promise<Actor> {
  const login = await request('/auth/dev', {
    display_name: name,
    region_id: region,
    locale: 'en',
    accept_rules: true,
  });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const result = await request('/me/state', undefined, cookie);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return { cookie, id: result.body.user.id, state: result.body };
}
const state = async (a: Actor) =>
  (await request('/me/state', undefined, a.cookie)).body as PlayerState;
const claim = async (a: Actor, tile: string, key = uuid()) =>
  request('/actions/claim', { territory_id: tile, idempotency_key: key }, a.cookie);
const sell = async (a: Actor, quantity = 5, price = 4, kind = 'food', key = uuid()) =>
  request('/market/orders', { kind, quantity, price_gold: price, idempotency_key: key }, a.cookie);
const buy = async (a: Actor, order: string, key = uuid()) =>
  request(`/market/orders/${order}/buy`, { idempotency_key: key }, a.cookie);
const cancel = async (a: Actor, order: string, key = uuid()) =>
  request(`/market/orders/${order}/cancel`, { idempotency_key: key }, a.cookie);
async function place(a: Actor, x: number, y: number, region = 'earth2:300:700:0:0:0:0:0:0') {
  await db
    .prepare(
      'UPDATE territories SET owner_user_id=NULL,production_at=NULL,acquired_at=NULL WHERE owner_user_id=?',
    )
    .bind(a.id)
    .run();
  await db
    .prepare(
      'UPDATE territories SET owner_user_id=?,production_at=unixepoch(),acquired_at=unixepoch() WHERE id=?',
    )
    .bind(a.id, `s1:${region}:${x}:${y}`)
    .run();
}
async function cooldown(a: Actor) {
  await db
    .prepare(
      "UPDATE actions SET created_at=created_at-3 WHERE user_id=? AND type IN ('sell','buy')",
    )
    .bind(a.id)
    .run();
}
async function ledgerMatches(a: Actor) {
  const s = await state(a);
  const gold = await db
    .prepare(
      'SELECT COALESCE(SUM(delta),0) AS total FROM gold_ledger WHERE user_id=? AND season_id=?',
    )
    .bind(a.id, 's1')
    .first<{ total: number }>();
  expect(s.gold_balance).toBe(gold!.total);
  for (const kind of ['food', 'wood', 'iron'] as const) {
    const row = await db
      .prepare(
        'SELECT COALESCE(SUM(delta),0) AS total FROM resource_ledger WHERE user_id=? AND season_id=? AND kind=?',
      )
      .bind(a.id, 's1', kind)
      .first<{ total: number }>();
    expect(s.resources[kind]).toBe(row!.total);
  }
}
beforeAll(async () => {
  const output = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'world',
          modules: true,
          script: output.outputFiles[0].text,
          compatibilityDate: '2026-10-01',
          d1Databases: ['DB'],
          bindings: {
            APP_ORIGIN: origin,
            DEV_AUTH_ENABLED: 'true',
            MARKET_ENABLED: 'true',
            WORLD_AUTO_SPLIT_ENABLED: 'true',
            GOOGLE_CLIENT_ID: '',
            COMBAT_ENABLED: 'false',
            PAYMENTS_ENABLED: 'false',
            LAND_TRADING_ENABLED: 'false',
          },
        },
      ],
      log: new Log(LogLevel.ERROR),
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    const source = await readFile(`migrations/${file}`, 'utf8');
    for (const block of source.split('-- statement')) {
      const sql = block
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
      if (sql) await db.prepare(sql).run();
    }
  }
  // Large, allocated world-grid fixtures isolate economic tests from the 8×8
  // on-demand allocation tests. Legacy pilot data is never used as a join target.
  for (const [legacy, target] of [
    ['han', 'earth2:800:600:0:0:0:0:0:0'],
    ['tagus', 'earth2:700:500:0:0:0:0:0:0'],
    ['lakes', 'earth2:300:700:0:0:0:0:0:0'],
  ]) {
    const tile = worldTileFromId(target)!;
    await db
      .prepare(
        `INSERT INTO regions(id,season_id,name,subtitle,longitude,latitude,width,height,status,land_count)
      SELECT ?,season_id,?,'Test fixture',longitude,latitude,width,height,'open',land_count FROM regions WHERE id=?`,
      )
      .bind(target, target, legacy)
      .run();
    await db
      .prepare(
        "INSERT INTO world_tiles(id,season_id,level,west,south,east,north) VALUES(?,'s1',6,?,?,?,?)",
      )
      .bind(target, tile.west, tile.south, tile.east, tile.north)
      .run();
    await db
      .prepare(
        'INSERT INTO chunk_versions SELECT season_id,?,cx,cy,version FROM chunk_versions WHERE region_id=?',
      )
      .bind(target, legacy)
      .run();
    await db
      .prepare(
        `INSERT INTO territories(id,region_id,season_id,x,y,cx,cy,terrain_type,is_starter)
      SELECT replace(id,?,?),?,season_id,x,y,cx,cy,terrain_type,is_starter FROM territories WHERE region_id=?`,
      )
      .bind(legacy, target, target, legacy)
      .run();
  }
});
afterAll(async () => {
  await mf?.dispose();
});

describe('free world and authentication', () => {
  it('excludes archived pilot cities from exploration and rejects new settlement there', async () => {
    const regions = await request('/regions');
    expect(
      regions.body.regions.some((r: { id: string }) => ['han', 'tagus', 'lakes'].includes(r.id)),
    ).toBe(false);
    const login = await request('/auth/dev', {
      display_name: 'No preset city',
      region_id: 'han',
      locale: 'en',
      accept_rules: true,
    });
    expect(login.status).toBe(404);
    expect(login.body.error.code).toBe('NOT_FOUND');
  });

  it('serves a public world with cached, bounded chunks and no private profile', async () => {
    const config = await request('/world/config');
    expect(config.status).toBe(200);
    expect(config.body.flags.payments).toBe(false);
    const chunk = await request('/map/chunks?region=earth2:800:600:0:0:0:0:0:0&cx=0&cy=0');
    expect(chunk.status).toBe(200);
    expect(chunk.body.tiles).toHaveLength(64);
    expect(chunk.headers.get('etag')).toBeTruthy();
    const same = await request(
      '/map/chunks?region=earth2:800:600:0:0:0:0:0:0&cx=0&cy=0',
      undefined,
      '',
      {
        headers: { 'If-None-Match': chunk.headers.get('etag')! },
      },
    );
    expect(same.status).toBe(304);
    expect((await request('/map/chunks?region=earth2:800:600:0:0:0:0:0:0&cx=32&cy=0')).status).toBe(
      400,
    );
    expect((await request('/me/state')).status).toBe(401);
  });
  it('allocates distinct starting tiles in concurrent signup and resumes a session', async () => {
    const [a, b] = await Promise.all([actor('Start A'), actor('Start B')]);
    expect(a.state.territories[0].id).not.toBe(b.state.territories[0].id);
    expect(a.state.gold_balance).toBe(100);
    expect(a.state.resources).toEqual({ food: 12, wood: 12, iron: 12 });
    const again = await actor('Start A');
    expect(again.id).toBe(a.id);
    expect(again.state.territory_count).toBe(1);
    await ledgerMatches(a);
    expect((await request('/me', undefined, a.cookie)).headers.get('cache-control')).toContain(
      'no-store',
    );
  });
  it('deduplicates concurrent registration of the same identity', async () => {
    const [a, b] = await Promise.all([actor('Same identity'), actor('Same identity')]);
    expect(a.id).toBe(b.id);
    expect((await state(a)).territory_count).toBe(1);
    const grant = await db
      .prepare("SELECT COUNT(*) AS n FROM gold_ledger WHERE user_id=? AND reason='starter'")
      .bind(a.id)
      .first<{ n: number }>();
    expect(grant!.n).toBe(1);
  });
  it('rejects an unknown starting region without granting any inventory', async () => {
    const before = await db
      .prepare('SELECT COUNT(*) AS n FROM player_state')
      .first<{ n: number }>();
    expect(
      (
        await request('/auth/dev', {
          display_name: 'No region',
          region_id: 'missing',
          locale: 'en',
          accept_rules: true,
        })
      ).body.error.code,
    ).toBe('NOT_FOUND');
    const after = await db.prepare('SELECT COUNT(*) AS n FROM player_state').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
  it('guards production local login, CSRF, admin, body limits and unsupported features', async () => {
    const a = await actor();
    expect(
      (
        await request(
          '/auth/dev',
          {
            display_name: 'Prod',
            region_id: 'earth2:800:600:0:0:0:0:0:0',
            locale: 'en',
            accept_rules: true,
          },
          '',
          { host: 'https://world.example' },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/actions/claim',
          { territory_id: 's1:earth2:800:600:0:0:0:0:0:0:3:2', idempotency_key: uuid() },
          a.cookie,
          { origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect((await request('/admin/metrics', undefined, a.cookie)).status).toBe(403);
    expect((await request('/payments/checkout', {}, a.cookie)).status).toBe(404);
    expect((await request('/payments/webhook', { gems: 999 }, a.cookie)).status).toBe(404);
    expect((await request('/actions/attack', {}, a.cookie)).status).toBe(404);
    expect(
      (await request('/me/profile', { display_name: 'x'.repeat(9000) }, a.cookie)).status,
    ).toBe(413);
    expect((await request('/auth/logout', {}, a.cookie)).status).toBe(200);
    expect((await request('/me', undefined, a.cookie)).status).toBe(401);
  });
});

describe('claims, recovery and production', () => {
  it('preserves fractional energy and restarts recovery at the cap', () => {
    expect(recoverEnergy(1, 100, 100 + TURN_SECONDS + 33)).toEqual({
      value: 2,
      updatedAt: 100 + TURN_SECONDS,
    });
    expect(recoverEnergy(4, 100, 300)).toEqual({ value: 4, updatedAt: 300 });
    expect(tradeTax(20)).toBe(1);
    expect(tradeTax(101)).toBe(4);
  });
  it('allows exactly one owner when two neighbors race to claim', async () => {
    const [a, b] = await Promise.all([actor(), actor()]);
    await place(a, 2, 20);
    await place(b, 4, 20);
    const results = await Promise.all([
      claim(a, 's1:earth2:300:700:0:0:0:0:0:0:3:20'),
      claim(b, 's1:earth2:300:700:0:0:0:0:0:0:3:20'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const states = await Promise.all([state(a), state(b)]);
    expect(states.map((s) => s.territory_count).sort()).toEqual([1, 2]);
    expect(states.reduce((n, s) => n + s.energy_value, 0)).toBe(7);
  });
  it('makes repeated claims idempotent and detects changed payloads', async () => {
    const a = await actor();
    await place(a, 8, 20);
    const key = uuid();
    const results = await Promise.all([
      claim(a, 's1:earth2:300:700:0:0:0:0:0:0:9:20', key),
      claim(a, 's1:earth2:300:700:0:0:0:0:0:0:9:20', key),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results[0].body.action_id).toBe(results[1].body.action_id);
    expect((await state(a)).energy_value).toBe(3);
    expect((await claim(a, 's1:earth2:300:700:0:0:0:0:0:0:8:19', key)).body.error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });
  it('rejects diagonal, water, client balances and overspending energy', async () => {
    const a = await actor();
    await place(a, 12, 20);
    expect((await claim(a, 's1:earth2:300:700:0:0:0:0:0:0:11:19')).body.error.code).toBe(
      'NOT_ADJACENT',
    );
    const water = await db
      .prepare("SELECT id FROM territories WHERE terrain_type='water' LIMIT 1")
      .first<{ id: string }>();
    expect((await claim(a, water!.id)).body.error.code).toBe('TERRITORY_UNAVAILABLE');
    expect(
      (
        await request(
          '/actions/claim',
          {
            territory_id: 's1:earth2:300:700:0:0:0:0:0:0:12:19',
            idempotency_key: uuid(),
            gold_balance: 5000,
          },
          a.cookie,
        )
      ).status,
    ).toBe(400);
    await db
      .prepare(
        'UPDATE player_state SET energy_value=0,energy_updated_at=unixepoch() WHERE user_id=?',
      )
      .bind(a.id)
      .run();
    expect((await claim(a, 's1:earth2:300:700:0:0:0:0:0:0:12:19')).body.error.code).toBe(
      'NO_ENERGY',
    );
  });
  it('settles production once under concurrent reads and retains partial time', async () => {
    const a = await actor();
    const tile = a.state.territories[0];
    await db
      .prepare('UPDATE territories SET production_at=unixepoch()-? WHERE id=?')
      .bind(TURN_SECONDS + 123, tile.id)
      .run();
    const results = await Promise.all([state(a), state(a)]);
    expect(results.every((s) => s.gold_balance === 101)).toBe(true);
    const current = await state(a);
    expect(Object.values(current.resources).reduce((a, b) => a + b, 0)).toBe(38);
    const clock = await db
      .prepare('SELECT production_at,unixepoch() AS now FROM territories WHERE id=?')
      .bind(tile.id)
      .first<{ production_at: number; now: number }>();
    expect(clock!.now - clock!.production_at).toBeGreaterThanOrEqual(123);
    expect(clock!.now - clock!.production_at).toBeLessThan(135);
    await ledgerMatches(a);
  });
  it('pays population income once, caps offline turns and exposes the source', async () => {
    const a = await actor();
    const tile = a.state.territories[0];
    await db
      .prepare('INSERT INTO territory_population VALUES(?,?,?,?,?,unixepoch()-?)')
      .bind(tile.id, 1250.75, 2020, 'https://data.worldpop.org/test.tif', '{}', TURN_SECONDS * 40)
      .run();
    await db
      .prepare('UPDATE territories SET production_at=unixepoch()-? WHERE id=?')
      .bind(TURN_SECONDS * 40 + 123, tile.id)
      .run();
    const results = await Promise.all([state(a), state(a)]);
    expect(results.every((s) => s.gold_balance === 100 + 28 * 13)).toBe(true);
    const detail = await request(`/territories/${tile.id}`);
    expect(detail.body.territory).toMatchObject({
      population: 1250.75,
      population_year: 2020,
      population_source: 'https://data.worldpop.org/test.tif',
    });
    expect((await state(a)).territories[0].population).toBe(1250.75);
    await ledgerMatches(a);
  });
  it('distinguishes zero population from missing data and does not backdate a new snapshot', async () => {
    const a = await actor();
    const tile = a.state.territories[0];
    expect((await request(`/territories/${tile.id}`)).body.territory.population).toBeUndefined();
    await db
      .prepare('INSERT INTO territory_population VALUES(?,?,?,?,?,unixepoch())')
      .bind(tile.id, 5000, 2020, 'https://data.worldpop.org/test.tif', '{}')
      .run();
    await db
      .prepare('UPDATE territories SET production_at=unixepoch()-? WHERE id=?')
      .bind(TURN_SECONDS * 2, tile.id)
      .run();
    expect((await state(a)).gold_balance).toBe(102);
    await db
      .prepare(
        'UPDATE territory_population SET population=0,effective_at=unixepoch()-? WHERE territory_id=?',
      )
      .bind(TURN_SECONDS, tile.id)
      .run();
    await db
      .prepare('UPDATE territories SET production_at=unixepoch()-? WHERE id=?')
      .bind(TURN_SECONDS, tile.id)
      .run();
    expect((await state(a)).gold_balance).toBe(103);
    expect((await request(`/territories/${tile.id}`)).body.territory.population).toBe(0);
    await ledgerMatches(a);
  });
  it('charges the land price on claims, scaled by population, and burns it', async () => {
    const a = await actor();
    await place(a, 2, 18);
    const dense = 's1:earth2:300:700:0:0:0:0:0:0:3:18';
    await db
      .prepare('INSERT INTO territory_population VALUES(?,?,?,?,?,?)')
      .bind(dense, 950.7, 2020, 'https://example.com/population', '[]', 1)
      .run();
    expect((await request(`/territories/${dense}`)).body.territory.price_gold).toBe(100);
    // 100 starter Gold covers exactly one such plot; a second costs 10 more than remains.
    const bought = await claim(a, dense);
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    expect(bought.body.result.price_gold).toBe(100);
    const after = await state(a);
    expect(after.gold_balance).toBe(0);
    expect(after.territory_count).toBe(2);
    const ledger = await db
      .prepare("SELECT delta FROM gold_ledger WHERE ref_id=? AND reason='claim'")
      .bind(bought.body.action_id)
      .first<{ delta: number }>();
    expect(ledger!.delta).toBe(-100);
    const broke = await claim(a, 's1:earth2:300:700:0:0:0:0:0:0:4:18');
    expect(broke.body.error.code).toBe('INSUFFICIENT_FUNDS');
    const unchanged = await state(a);
    expect(unchanged.territory_count).toBe(2);
    expect(unchanged.energy_value).toBe(after.energy_value);
    await ledgerMatches(a);
  });
  it('caps offline earnings at 28 turns and never rewards new territory retroactively', async () => {
    const a = await actor();
    await place(a, 2, 16);
    await db
      .prepare('UPDATE territories SET production_at=unixepoch()-? WHERE owner_user_id=?')
      .bind(TURN_SECONDS * 40, a.id)
      .run();
    const result = await claim(a, 's1:earth2:300:700:0:0:0:0:0:0:3:16');
    expect(result.status).toBe(200);
    // 100 starter + 28 capped turns - 10 for the claimed plot.
    expect(result.body.result.price_gold).toBe(10);
    const current = await state(a);
    expect(current.gold_balance).toBe(118);
    expect(Object.values(current.resources).reduce((a, b) => a + b, 0)).toBe(36 + 56);
    expect((await state(a)).gold_balance).toBe(118);
    await ledgerMatches(a);
  });
  it('builds atomically with ledgers and prevents ownership theft or duplicate costs', async () => {
    const a = await actor(),
      b = await actor();
    const tile = a.state.territories[0].id,
      key = uuid();
    expect(
      (
        await request(
          '/structures/build',
          { territory_id: tile, idempotency_key: uuid() },
          b.cookie,
        )
      ).body.error.code,
    ).toBe('CANNOT_BUILD');
    const first = await request(
      '/structures/build',
      { territory_id: tile, idempotency_key: key },
      a.cookie,
    );
    expect(first.status).toBe(200);
    expect(
      (await request('/structures/build', { territory_id: tile, idempotency_key: key }, a.cookie))
        .body.replayed,
    ).toBe(true);
    const current = await state(a);
    expect(current.gold_balance).toBe(80);
    expect(current.resources.wood).toBe(4);
    expect(current.resources.iron).toBe(8);
    expect(current.territories[0].structure_type).toBeTruthy();
    expect(
      (
        await request(
          '/structures/build',
          { territory_id: tile, idempotency_key: uuid() },
          a.cookie,
        )
      ).status,
    ).toBe(409);
    await ledgerMatches(a);
  });
});

describe('market escrow and ledger conservation', () => {
  it('conserves resources and burns exactly the tax when buyers race', async () => {
    const [seller, a, b] = await Promise.all([actor(), actor(), actor()]);
    const order = await sell(seller);
    expect(order.status).toBe(200);
    expect((await state(seller)).resources.food).toBe(7);
    const result = await Promise.all([
      buy(a, order.body.result.order_id),
      buy(b, order.body.result.order_id),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
    const states = await Promise.all([state(seller), state(a), state(b)]);
    expect(states.reduce((n, s) => n + s.gold_balance, 0)).toBe(299);
    expect(states.reduce((n, s) => n + s.resources.food, 0)).toBe(36);
    expect(states[0].gold_balance).toBe(119);
    await Promise.all([ledgerMatches(seller), ledgerMatches(a), ledgerMatches(b)]);
  });
  it('returns escrow once on cancel and rejects unauthorized cancellation', async () => {
    const a = await actor(),
      b = await actor();
    const order = (await sell(a, 7, 2, 'wood')).body.result.order_id;
    expect((await cancel(b, order)).status).toBe(409);
    const key = uuid();
    const results = await Promise.all([cancel(a, order, key), cancel(a, order, key)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await state(a)).resources.wood).toBe(12);
    expect((await buy(b, order)).status).toBe(409);
    expect((await cancel(a, order)).status).toBe(409);
    await ledgerMatches(a);
  });
  it('handles simultaneous cancellation and purchase without duplication', async () => {
    const a = await actor(),
      b = await actor();
    const order = (await sell(a, 3, 5, 'iron')).body.result.order_id;
    const result = await Promise.all([cancel(a, order), buy(b, order)]);
    expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
    const [sa, sb] = await Promise.all([state(a), state(b)]);
    expect(sa.resources.iron + sb.resources.iron).toBe(24);
    expect([199, 200]).toContain(sa.gold_balance + sb.gold_balance);
    await ledgerMatches(a);
    await ledgerMatches(b);
  });
  it('rejects self-trading, fractional input, insufficient resources and Gold', async () => {
    const a = await actor(),
      b = await actor();
    expect((await sell(a, 13)).body.error.code).toBe('INSUFFICIENT_RESOURCES');
    expect((await sell(a, 1.5)).status).toBe(400);
    const order = (await sell(a, 1, 101)).body.result.order_id;
    await cooldown(a);
    expect((await buy(a, order)).body.error.code).toBe('SELF_TRADE');
    expect((await buy(b, order)).body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await state(a)).resources.food).toBe(11);
    expect((await state(b)).gold_balance).toBe(100);
    const row = await db
      .prepare('SELECT status FROM market_orders WHERE id=?')
      .bind(order)
      .first<{ status: string }>();
    expect(row!.status).toBe('open');
    await ledgerMatches(a);
    await ledgerMatches(b);
  });
  it('replays purchases without new debits and enforces a trade cooldown', async () => {
    const a = await actor(),
      b = await actor();
    const order = (await sell(a, 2, 3)).body.result.order_id;
    expect((await sell(a, 1)).body.error.code).toBe('TRADE_COOLDOWN');
    const key = uuid();
    expect((await buy(b, order, key)).status).toBe(200);
    expect((await buy(b, order, key)).body.replayed).toBe(true);
    expect((await state(b)).gold_balance).toBe(94);
    await ledgerMatches(b);
  });
  it('makes ledgers immutable at the database boundary', async () => {
    const a = await actor();
    await expect(
      db.prepare('UPDATE gold_ledger SET delta=999 WHERE user_id=?').bind(a.id).run(),
    ).rejects.toThrow('IMMUTABLE_LEDGER');
    await expect(
      db.prepare('DELETE FROM resource_ledger WHERE user_id=?').bind(a.id).run(),
    ).rejects.toThrow('IMMUTABLE_LEDGER');
    await ledgerMatches(a);
  });
  it('rejects a blocked seller even when a buyer submits a stale order ID', async () => {
    const a = await actor(),
      b = await actor();
    const order = (await sell(a)).body.result.order_id;
    await db.prepare("UPDATE users SET status='blocked' WHERE id=?").bind(a.id).run();
    expect((await buy(b, order)).body.error.code).toBe('ORDER_UNAVAILABLE');
    expect((await state(b)).gold_balance).toBe(100);
  });
});

describe('operations and season boundaries', () => {
  it('accepts reports only for existing targets and restricts resolution to admins', async () => {
    const a = await actor();
    expect(
      (
        await request(
          '/reports',
          { target_type: 'territory', target_id: 'missing', reason: 'A real concern' },
          a.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          '/reports',
          {
            target_type: 'territory',
            target_id: a.state.territories[0].id,
            reason: 'Please review this tile',
          },
          a.cookie,
        )
      ).status,
    ).toBe(200);
    await db.prepare("UPDATE users SET role='admin' WHERE id=?").bind(a.id).run();
    const metrics = await request('/admin/metrics', undefined, a.cookie);
    expect(metrics.status).toBe(200);
    expect(metrics.body.reports.length).toBeGreaterThan(0);
    const report = metrics.body.reports[0];
    expect(
      (await request(`/admin/reports/${report.id}`, { status: 'resolved' }, a.cookie)).status,
    ).toBe(200);
  });
  it('throttles repeated requests and invalidates blocked and expired sessions', async () => {
    const a = await actor();
    const bucket = Math.floor(Date.now() / 1000 / 60);
    await db
      .prepare('INSERT OR REPLACE INTO rate_limits VALUES(?,?,?)')
      .bind(`user:${a.id}:${bucket}`, 121, (bucket + 1) * 60)
      .run();
    expect((await request('/me', undefined, a.cookie)).status).toBe(429);
    await db.prepare('DELETE FROM rate_limits WHERE key=?').bind(`user:${a.id}:${bucket}`).run();
    await db.prepare("UPDATE users SET status='blocked' WHERE id=?").bind(a.id).run();
    expect((await request('/me', undefined, a.cookie)).status).toBe(401);
    const b = await actor();
    await db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').bind(b.id).run();
    expect((await request('/me', undefined, b.cookie)).status).toBe(401);
  });
  it('keeps territory in a permanent world that never expires', async () => {
    const season = await db
      .prepare("SELECT ends_at,rules_version FROM seasons WHERE status='active'")
      .first<{ ends_at: number; rules_version: string }>();
    expect(isPermanent(season!)).toBe(true);
    expect(season!.rules_version).toBe('land-v2');
    expect((await request('/world/config')).body.season.ends_at).toBe(PERMANENT_ENDS_AT);
  });
  it('stops seasonal commands without destroying balances or historical records', async () => {
    const a = await actor();
    const original = await db
      .prepare("SELECT ends_at FROM seasons WHERE id='s1'")
      .first<{ ends_at: number }>();
    await db
      .prepare("UPDATE seasons SET begins_at=unixepoch()-86400,ends_at=unixepoch()-1 WHERE id='s1'")
      .run();
    expect((await sell(a)).body.error.code).toBe('SEASON_ENDED');
    expect((await state(a)).gold_balance).toBe(100);
    await db.prepare("UPDATE seasons SET ends_at=? WHERE id='s1'").bind(original!.ends_at).run();
  });
  it('starts a fresh season without losing accounts, ledgers or achievements', async () => {
    const a = await actor();
    const home = a.state.territories[0].id;
    await request('/structures/build', { territory_id: home, idempotency_key: uuid() }, a.cookie);
    await db.prepare("UPDATE seasons SET status='ended' WHERE id='s1'").run();
    const seed =
      "INSERT INTO seasons VALUES('s2',unixepoch(),unixepoch()+2592000,'active','global-v1')";
    try {
      for (const block of seed.split('-- statement')) {
        const sql = block.trim();
        if (sql) await db.prepare(sql).run();
      }
      expect(
        await db.prepare("SELECT COUNT(*) AS n FROM regions WHERE season_id='s2'").first('n'),
      ).toBe(0);
      expect((await request('/me/state', undefined, a.cookie)).body.error.code).toBe('NOT_JOINED');
      expect(
        (await request('/join', { region_id: 'z14:13970:6345', accept_rules: true }, a.cookie))
          .status,
      ).toBe(200);
      const next = await state(a);
      expect(next.season.id).toBe('s2');
      expect(next.gold_balance).toBe(100);
      expect(next.territory_count).toBe(1);
      expect(next.achievements.some((x) => x.kind === 'builder')).toBe(true);
      const prior = await db
        .prepare('SELECT owner_user_id FROM territories WHERE id=?')
        .bind(home)
        .first<{ owner_user_id: string }>();
      expect(prior!.owner_user_id).toBe(a.id);
      const history = (await request('/me/transactions', undefined, a.cookie)).body.history;
      expect(history).toHaveLength(2);
    } finally {
      await db.prepare("UPDATE seasons SET status='ended' WHERE id='s2'").run();
      await db.prepare("UPDATE seasons SET status='active' WHERE id='s1'").run();
    }
  });
});

describe('global plot grid', () => {
  it('previews unallocated plot regions without creating rows', async () => {
    const regions = await request('/regions', undefined, '', {
      headers: { 'cache-control': 'no-cache' },
    });
    expect(regions.body.regions.length).toBeLessThanOrEqual(128);
    const overview = await request('/world/tiles');
    expect(overview.body.tiles.length).toBeLessThanOrEqual(2048);
    const region = plotAt(-58.38, -34.6).region;
    const virtualRegion = await request(`/regions/${region}`);
    expect(virtualRegion.status).toBe(200);
    expect(virtualRegion.body.region.id).toBe(region);
    const preview = await request(`/map/chunks?region=${region}&cx=0&cy=0`);
    expect(preview.status).toBe(200);
    expect(preview.body.tiles).toHaveLength(64);
    const detail = await request(`/territories/${preview.body.tiles[0].id}`);
    expect(detail.body.territory).toEqual({ ...preview.body.tiles[0], price_gold: 10 });
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM territories WHERE region_id=?')
        .bind(region)
        .first('n'),
    ).toBe(0);
    expect((await request(`/map/chunks?region=${region}&cx=1&cy=0`)).status).toBe(404);
    // Version 1 world tiles are no longer settlement regions.
    expect((await request('/regions/earth2:873:725')).status).toBe(404);
  });
  it('settles the chosen plot and maps it to its real coordinates', async () => {
    const home = plotAt(127.0276, 37.4979);
    const id = plotTerritoryId('s1', home);
    const login = await request('/auth/dev', {
      display_name: 'Gangnam Settler',
      region_id: home.region,
      territory_id: id,
      locale: 'en',
      accept_rules: true,
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const owned = (await request('/me/state', undefined, cookie)).body as PlayerState;
    expect(owned.territories.map((t) => t.id)).toEqual([id]);
    expect([owned.territories[0].gx, owned.territories[0].gy]).toEqual([home.gx, home.gy]);
    const [west, north] = gridPoint(regionFor(home.region, 's1')!, home.x, home.y);
    const [east, south] = gridPoint(regionFor(home.region, 's1')!, home.x + 1, home.y + 1);
    expect(west).toBeLessThanOrEqual(127.0276);
    expect(east).toBeGreaterThan(127.0276);
    expect(south).toBeLessThanOrEqual(37.4979);
    expect(north).toBeGreaterThan(37.4979);
    const rival = await request('/auth/dev', {
      display_name: 'Gangnam Rival',
      region_id: home.region,
      territory_id: id,
      locale: 'en',
      accept_rules: true,
    });
    expect(rival.body.error.code).toBe('TERRITORY_UNAVAILABLE');
    const elsewhere = await request('/auth/dev', {
      display_name: 'Region Mismatch',
      region_id: plotAt(126.97, 37.57).region,
      territory_id: id,
      locale: 'en',
      accept_rules: true,
    });
    expect(elsewhere.body.error.code).toBe('TERRITORY_UNAVAILABLE');
  });
  it('grows across region edges and allocates the next region on demand', async () => {
    const start = plotAt(139.69, 35.68);
    const edge = { ...start, gx: start.gx - start.x + 7, x: 7 };
    const login = await request('/auth/dev', {
      display_name: 'Edge Walker',
      region_id: edge.region,
      territory_id: plotTerritoryId('s1', edge),
      locale: 'en',
      accept_rules: true,
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const a: Actor = {
      cookie: login.headers.get('set-cookie')!.split(';')[0],
      id: '',
      state: {} as PlayerState,
    };
    const [rx, ry] = edge.region.split(':').slice(1).map(Number);
    const next = plotRegionId(rx + 1, ry);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM territories WHERE region_id=?')
        .bind(next)
        .first('n'),
    ).toBe(0);
    expect((await claim(a, `s1:${next}:1:${edge.y}`)).body.error.code).toBe('NOT_ADJACENT');
    expect((await claim(a, `s1:${next}:0:${(edge.y + 1) % 8}`)).body.error.code).toBe(
      'NOT_ADJACENT',
    );
    const across = await claim(a, `s1:${next}:0:${edge.y}`);
    expect(across.status, JSON.stringify(across.body)).toBe(200);
    const owned = (await request('/me/state', undefined, a.cookie)).body as PlayerState;
    expect(owned.territories.map((t) => t.region_id).sort()).toEqual([edge.region, next].sort());
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM territories WHERE region_id=?')
        .bind(next)
        .first('n'),
    ).toBe(64);
  });
});

describe('bounded million-tile view API', () => {
  it('handles date-line viewports and rejects malformed bounds', async () => {
    const view = await request('/world/tiles?bbox=179,-1,181,1');
    expect(view.status).toBe(200);
    expect(view.body.tiles.length).toBeLessThanOrEqual(2048);
    expect(view.body.tiles.some((t: { west: number }) => t.west < -179)).toBe(true);
    expect(view.body.tiles.some((t: { east: number }) => t.east > 179)).toBe(true);
    for (const bbox of ['1,2,0,3', '0,-91,1,1', '0,0,361,1', 'NaN,0,1,1', '0,0,1'])
      expect((await request(`/world/tiles?bbox=${bbox}`)).status).toBe(400);
    expect((await request('/regions/earth2:1024:0')).status).toBe(404);
    expect((await request('/regions/z14:16384:0')).status).toBe(404);
  });
});

describe('public map overlays', () => {
  it('returns actual regional settlement, claim and construction events without action payloads', async () => {
    const region = plotRegionId(9120, 6120);
    const explorer = await actor('Map Activity Explorer', region);
    const home = explorer.state.territories[0];
    const target = `${home.season_id}:${region}:1:0`;
    expect((await claim(explorer, target)).status).toBe(200);
    expect(
      (
        await request(
          '/structures/build',
          { territory_id: target, idempotency_key: uuid() },
          explorer.cookie,
        )
      ).status,
    ).toBe(200);
    const result = await request(`/map/activity?region=${region}`, undefined, '', {
      headers: { 'Cache-Control': 'no-cache' },
    });
    expect(result.status).toBe(200);
    expect(result.body.activities).toHaveLength(3);
    expect(result.body.activities.map((entry: { type: string }) => entry.type).sort()).toEqual([
      'build',
      'claim',
      'join',
    ]);
    for (const entry of result.body.activities) {
      expect(entry.region_id).toBe(region);
      expect(entry.actor_name).toBe('Map Activity Explorer');
      expect(entry).not.toHaveProperty('payload_json');
      expect(entry).not.toHaveProperty('user_id');
    }
    expect(
      (await request(`/map/activity?region=${plotRegionId(9119, 6120)}`)).body.activities,
    ).toEqual([]);
    expect((await request('/map/activity')).body.activities.length).toBeLessThanOrEqual(30);
    await db.prepare("UPDATE users SET status='blocked' WHERE id=?").bind(explorer.id).run();
    expect(
      (
        await request(`/map/activity?region=${region}`, undefined, '', {
          headers: { 'Cache-Control': 'no-cache' },
        })
      ).body.activities,
    ).toEqual([]);
  });
  it('returns imported population for virtual plots and leaves unknown plots absent', async () => {
    const region = plotRegionId(9130, 6130);
    const territory = `s1:${region}:2:3`;
    await db
      .prepare('INSERT INTO territory_population VALUES(?,?,?,?,?,?)')
      .bind(territory, 1234, 2025, 'https://example.com/population', '[]', 1)
      .run();
    const result = await request(`/map/population?region=${region}`);
    expect(result.status).toBe(200);
    expect(result.body.samples).toEqual([
      {
        territory_id: territory,
        population: 1234,
        year: 2025,
        source: 'https://example.com/population',
      },
    ]);
    expect(
      (await request(`/map/population?region=${plotRegionId(9140, 6130)}`)).body.samples,
    ).toEqual([]);
    expect((await request('/map/population?region=earth2:1024:0')).status).toBe(404);
    expect((await request('/map/population')).status).toBe(400);
  });
});
