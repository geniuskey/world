import { Hono } from 'hono';
import { routePath } from 'hono/route';
import { bodyLimit } from 'hono/body-limit';
import { ZodError, z } from 'zod';
import { CHUNK_SIZE, TURN_SECONDS } from '../shared/game';
import {
  claimSchema,
  sellSchema,
  keySchema,
  landPriceSchema,
  profileSchema,
  reportSchema,
  id,
} from '../shared/schemas';
import { Db } from './db';
import { withPopulation } from './population';
import { prepareSettlement, regionExists, worldTiles, virtualTerritories } from './world';
import { isPlotRegion, parseTerritoryId, plotRegion } from '../shared/plots';
import { WORLD_INITIAL_TILES, WORLD_SPLIT_PLAYERS, WORLD_MAX_LEVEL } from '../shared/worldGrid';
import { ApiError, type AppEnv, type Ctx, type Env } from './types';
import { authenticate, devLogin, startOAuth, finishOAuth, logout, localAuth, sha256 } from './auth';
import { command, currentSeason, join, landQuote, playerState, snapshot } from './game';

const app = new Hono<AppEnv>();
const security = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'self'",
};
async function jsonBody(c: Ctx) {
  if (!c.req.header('content-type')?.startsWith('application/json'))
    throw new ApiError('JSON_REQUIRED', 415);
  try {
    return await c.req.json();
  } catch {
    throw new ApiError('INVALID_JSON');
  }
}
async function limit(c: Ctx, key: string, max: number, window = 60) {
  const bucket = Math.floor(c.get('now') / window);
  const row = await c
    .get('db')
    .first<{ count: number }>(
      'INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
      `${key}:${bucket}`,
      (bucket + 1) * window,
    );
  if (row!.count > max) {
    c.header('Retry-After', String(window));
    throw new ApiError('RATE_LIMITED', 429);
  }
}
async function publicCache(c: Ctx, ttl: number, make: () => Promise<Response>) {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const key = new Request(c.req.url, { method: 'GET' });
  const cached = c.req.header('cache-control') === 'no-cache' ? undefined : await cache.match(key);
  if (cached) {
    c.set('cacheHit', true);
    if (
      c.req.header('if-none-match') &&
      c.req.header('if-none-match') === cached.headers.get('ETag')
    )
      return new Response(null, { status: 304, headers: cached.headers });
    const result = new Response(cached.body, cached);
    result.headers.set('Cache-Status', 'WORLD; hit');
    return result;
  }
  const response = await make();
  response.headers.set('Cache-Control', `public, max-age=0, s-maxage=${ttl}`);
  response.headers.set('Cache-Status', 'WORLD; fwd=miss');
  c.executionCtx.waitUntil(cache.put(key, response.clone()));
  if (
    c.req.header('if-none-match') &&
    c.req.header('if-none-match') === response.headers.get('ETag')
  )
    return new Response(null, { status: 304, headers: response.headers });
  return response;
}
app.use('/api/*', async (c, next) => {
  const started = Date.now(),
    db = new Db(c.env.DB);
  c.set('db', db);
  c.set('now', Math.floor(started / 1000));
  c.set('cacheHit', false);
  c.header('Cache-Control', 'private, no-store');
  for (const [k, v] of Object.entries(security)) c.header(k, v);
  await next();
  // Registered route templates keep telemetry bounded and exclude identifiers.
  const route = routePath(c) || '/api/*';
  const day = new Date(started).toISOString().slice(0, 10);
  c.executionCtx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO daily_metrics(day,route,requests,errors,rows_read,rows_written,cache_hits) VALUES(?,?,1,?,?,?,?) ON CONFLICT(day,route) DO UPDATE SET requests=requests+1,errors=errors+excluded.errors,rows_read=rows_read+excluded.rows_read,rows_written=rows_written+excluded.rows_written,cache_hits=cache_hits+excluded.cache_hits`,
    )
      .bind(
        day,
        route,
        c.res.status >= 400 ? 1 : 0,
        db.rowsRead,
        db.rowsWritten,
        c.get('cacheHit') ? 1 : 0,
      )
      .run(),
  );
  console.log(
    JSON.stringify({
      route,
      status: c.res.status,
      ms: Date.now() - started,
      rows_read: db.rowsRead,
      rows_written: db.rowsWritten,
      cache_hit: c.get('cacheHit'),
    }),
  );
});
app.use(
  '/api/*',
  bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413) }),
);
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    if (c.req.header('origin') !== c.env.APP_ORIGIN) throw new ApiError('ORIGIN_REJECTED', 403);
  }
  const path = c.req.path;
  const needsAuth =
    /^\/api\/(me|actions|structures|reports|admin|events|join)(\/|$)/.test(path) ||
    (/^\/api\/(market|land)\//.test(path) && c.req.method !== 'GET');
  if (needsAuth) {
    const user = await authenticate(c);
    await limit(c, `user:${user.id}`, c.req.method === 'GET' ? 120 : 30);
  } else if (c.req.method !== 'GET') {
    const client = await sha256(
      `${c.req.header('cf-connecting-ip') || 'local'}:${Math.floor(c.get('now') / 86400)}`,
    );
    await limit(c, `anon:${client}`, path.startsWith('/api/auth') ? 15 : 30);
  }
  await next();
});

app.get('/api/world/config', (c) =>
  publicCache(c, 15, async () =>
    c.json({
      season: await currentSeason(c.get('db')),
      server_time: c.get('now'),
      turn_seconds: TURN_SECONDS,
      chunk_size: CHUNK_SIZE,
      world_grid: {
        initial_tiles: WORLD_INITIAL_TILES,
        auto_split: c.env.WORLD_AUTO_SPLIT_ENABLED === 'true',
        split_players: WORLD_SPLIT_PLAYERS,
        max_level: WORLD_MAX_LEVEL,
      },
      flags: {
        market: c.env.MARKET_ENABLED === 'true',
        combat: false,
        payments: false,
        land_trading: c.env.LAND_TRADING_ENABLED === 'true',
      },
      land: await c
        .get('db')
        .first('SELECT buyout_premium_pct,protection_seconds,cooldown_seconds FROM land_rules'),
      auth: {
        dev: localAuth(c),
        google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      },
    }),
  ),
);
app.get('/api/world/tiles', (c) =>
  publicCache(c, 15, async () => {
    const db = c.get('db'),
      season = await currentSeason(db);
    const bbox = c.req.query('bbox');
    let bounds;
    if (bbox) {
      const [west, south, east, north] = z
        .array(z.coerce.number().finite())
        .length(4)
        .parse(bbox.split(','));
      if (south < -90 || north > 90 || south >= north || west >= east || east - west > 360)
        throw new ApiError('INVALID_INPUT', 400);
      bounds = { west, south, east, north };
    }
    return c.json(await worldTiles(db, season.id, bounds));
  }),
);
app.get('/api/regions', (c) =>
  publicCache(c, 60, async () => {
    const season = await currentSeason(c.get('db'));
    return c.json({
      regions: await c
        .get('db')
        .all(
          "SELECT r.*,w.split AS world_split,w.level AS world_level,w.parent_id,owned_count AS owned,land_count-owned_count AS available FROM regions r LEFT JOIN world_tiles w ON w.id=r.id AND w.season_id=r.season_id WHERE r.season_id=? AND r.status='open' AND (w.id IS NOT NULL OR r.id LIKE 'z14:%') AND r.owned_count>0 ORDER BY w.level IS NOT NULL,r.rowid DESC LIMIT 128",
          season.id,
        ),
    });
  }),
);
app.get('/api/regions/:id', async (c) => {
  const db = c.get('db'),
    season = await currentSeason(db),
    regionId = id.parse(c.req.param('id'));
  const region = await db.first(
    `SELECT r.*,w.split AS world_split,w.level AS world_level,w.parent_id,
    owned_count AS owned,land_count-owned_count AS available FROM regions r LEFT JOIN world_tiles w
    ON w.id=r.id AND w.season_id=r.season_id WHERE r.id=? AND r.season_id=?`,
    regionId,
    season.id,
  );
  if (region) return c.json({ region });
  const plots = plotRegion(regionId, season.id);
  if (!plots) throw new ApiError('NOT_FOUND', 404);
  return c.json({ region: plots });
});
app.get('/api/map/chunks', (c) =>
  publicCache(c, 60, async () => {
    const region = id.parse(c.req.query('region'));
    const cx = z.coerce.number().int().min(0).max(31).parse(c.req.query('cx'));
    const cy = z.coerce.number().int().min(0).max(31).parse(c.req.query('cy'));
    const db = c.get('db'),
      season = await currentSeason(db);
    const version = await db.first<{ version: number }>(
      'SELECT version FROM chunk_versions WHERE season_id=? AND region_id=? AND cx=? AND cy=?',
      season.id,
      region,
      cx,
      cy,
    );
    if (!version) {
      if (!(await regionExists(db, season.id, region)) || cx !== 0 || cy !== 0)
        throw new ApiError('CHUNK_NOT_FOUND', 404);
      return c.json({ region, cx, cy, version: 0, tiles: virtualTerritories(season.id, region) });
    }
    const etag = `"${season.id}-${region}-${cx}-${cy}-${version.version}"`;
    const tiles = await db.all(
      'SELECT id,region_id,season_id,x,y,gx,gy,cx,cy,terrain_type,owner_user_id,acquired_at,version,structure_type,is_starter FROM territories WHERE season_id=? AND region_id=? AND cx=? AND cy=? ORDER BY y,x',
      season.id,
      region,
      cx,
      cy,
    );
    return c.json({ region, cx, cy, version: version.version, tiles }, 200, { ETag: etag });
  }),
);
app.get('/api/map/population', (c) =>
  publicCache(c, 60, async () => {
    const region = id.parse(c.req.query('region'));
    const db = c.get('db'),
      season = await currentSeason(db);
    if (!(await regionExists(db, season.id, region))) throw new ApiError('NOT_FOUND', 404);
    const ids = virtualTerritories(season.id, region).map((tile) => tile.id);
    const samples = await db.all(
      `SELECT territory_id,population,year,source FROM territory_population
       WHERE territory_id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(ids),
    );
    return c.json({ samples });
  }),
);
app.get('/api/map/activity', (c) =>
  publicCache(c, 15, async () => {
    const region = c.req.query('region') ? id.parse(c.req.query('region')) : null;
    const db = c.get('db'),
      season = await currentSeason(db);
    const activities = await db.all(
      `SELECT a.id,a.type,a.created_at,p.display_name AS actor_name,
        t.id AS territory_id,t.region_id,t.x,t.y,r.longitude,r.latitude
       FROM actions a JOIN territories t ON t.id=json_extract(a.result_json,'$.territory_id') AND t.season_id=a.season_id
       JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id
       JOIN profiles p ON p.user_id=a.user_id JOIN users u ON u.id=a.user_id
       WHERE a.season_id=? AND a.type IN ('join','claim','build') AND a.status='completed'
         AND u.status='active' ${region ? 'AND t.region_id=?' : ''}
       ORDER BY a.created_at DESC,a.id DESC LIMIT 30`,
      ...[season.id, ...(region ? [region] : [])],
    );
    return c.json({ activities });
  }),
);
app.get('/api/territories/:id', async (c) => {
  const tile = await c
    .get('db')
    .first(
      'SELECT t.*,p.display_name AS owner_name FROM territories t LEFT JOIN profiles p ON p.user_id=t.owner_user_id WHERE t.id=?',
      id.parse(c.req.param('id')),
    );
  if (!tile) {
    const season = await currentSeason(c.get('db'));
    const match = parseTerritoryId(c.req.param('id'));
    if (match?.season === season.id && (await regionExists(c.get('db'), season.id, match.region))) {
      const virtual = virtualTerritories(season.id, match.region).find(
        (t) => t.id === c.req.param('id'),
      );
      if (virtual) return c.json({ territory: await withPopulation(c.get('db'), virtual) });
    }
    throw new ApiError('NOT_FOUND', 404);
  }
  const territory = await withPopulation(c.get('db'), tile as import('../shared/game').Territory);
  return c.json({ territory: { ...territory, ...(await landQuote(c.get('db'), territory)) } });
});
app.get('/api/leaderboards', (c) =>
  publicCache(c, 3600, async () => {
    const db = c.get('db'),
      season = c.req.query('season')
        ? id.parse(c.req.query('season'))
        : (await currentSeason(db)).id;
    if (!(await db.first('SELECT id FROM seasons WHERE id=?', season)))
      throw new ApiError('NOT_FOUND', 404);
    return c.json({ season, ...(await snapshot(db, season, c.get('now'))) });
  }),
);
app.get('/api/seasons', async (c) =>
  c.json({
    seasons: await c.get('db').all('SELECT * FROM seasons ORDER BY begins_at DESC LIMIT 24'),
  }),
);

app.post('/api/auth/dev', async (c) => {
  await devLogin(c, await jsonBody(c));
  return c.json({ ok: true });
});
app.post('/api/auth/google', async (c) => c.json({ url: await startOAuth(c, await jsonBody(c)) }));
app.get('/api/auth/callback', async (c) => {
  try {
    return await finishOAuth(c);
  } catch {
    return c.redirect(`${c.env.APP_ORIGIN}/?auth_error=1`);
  }
});
app.post('/api/auth/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});
app.get('/api/me', (c) => c.json({ user: c.get('user') }));
app.get('/api/me/state', async (c) =>
  c.json(await playerState(c.get('db'), c.get('user'), c.get('now'))),
);
app.post('/api/join', async (c) => {
  const body = z
    .object({ region_id: id, territory_id: id.optional(), accept_rules: z.literal(true) })
    .strict()
    .parse(await jsonBody(c));
  await join(c.get('db'), c.get('user').id, body.region_id, c.get('now'), body.territory_id);
  return c.json({ ok: true });
});
app.post('/api/me/profile', async (c) => {
  const body = profileSchema.parse(await jsonBody(c));
  await c
    .get('db')
    .run(
      'UPDATE profiles SET display_name=?,locale=?,flag_style=? WHERE user_id=?',
      body.display_name,
      body.locale,
      body.flag_style,
      c.get('user').id,
    );
  return c.json({ ok: true });
});
app.get('/api/me/transactions', async (c) => {
  const db = c.get('db'),
    user = c.get('user').id,
    season = (await currentSeason(db)).id;
  const [gold, resources, orders, history] = await Promise.all([
    db.all(
      'SELECT delta,reason,ref_id,created_at FROM gold_ledger WHERE user_id=? AND season_id=? ORDER BY created_at DESC,id DESC LIMIT 50',
      user,
      season,
    ),
    db.all(
      'SELECT kind,delta,reason,ref_id,created_at FROM resource_ledger WHERE user_id=? AND season_id=? ORDER BY created_at DESC,id DESC LIMIT 50',
      user,
      season,
    ),
    db.all(
      'SELECT * FROM market_orders WHERE seller_user_id=? AND season_id=? ORDER BY created_at DESC LIMIT 50',
      user,
      season,
    ),
    db.all(
      'SELECT p.season_id,p.territory_count,p.produced_total,s.begins_at,s.ends_at FROM player_state p JOIN seasons s ON s.id=p.season_id WHERE p.user_id=? ORDER BY s.begins_at DESC LIMIT 24',
      user,
    ),
  ]);
  return c.json({ gold, resources, orders, history });
});
for (const [path, type] of [
  ['/api/actions/claim', 'claim'],
  ['/api/structures/build', 'build'],
] as const)
  app.post(path, async (c) => {
    const { territory_id, idempotency_key } = claimSchema.parse(await jsonBody(c));
    const db = c.get('db'),
      season = await currentSeason(db);
    // Plot regions are allocated lazily, so claiming across a region edge allocates it first.
    const target = parseTerritoryId(territory_id);
    if (type === 'claim' && target?.season === season.id && isPlotRegion(target.region))
      await prepareSettlement(db, season.id, target.region);
    return c.json(
      await command(
        db,
        c.get('user').id,
        season.id,
        type,
        { territory_id },
        idempotency_key,
        c.get('now'),
      ),
    );
  });

const market = (c: Ctx) => {
  if (c.env.MARKET_ENABLED !== 'true') throw new ApiError('FEATURE_DISABLED', 404);
};
app.get('/api/market/orders', async (c) => {
  market(c);
  const db = c.get('db'),
    season = await currentSeason(db);
  const kind = z.enum(['all', 'food', 'wood', 'iron']).parse(c.req.query('kind') || 'all');
  const cursor = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .parse(c.req.query('offset') || 0);
  const orders = await db.all(
    `SELECT o.*,p.display_name AS seller_name,u.is_test FROM market_orders o JOIN profiles p ON p.user_id=o.seller_user_id JOIN users u ON u.id=o.seller_user_id WHERE o.season_id=? AND o.status='open' AND (?='all' OR o.kind=?) AND u.status='active' ORDER BY o.created_at DESC,o.id LIMIT 51 OFFSET ?`,
    season.id,
    kind,
    kind,
    cursor,
  );
  return c.json({
    orders: orders.slice(0, 50),
    next_offset: orders.length > 50 ? cursor + 50 : null,
  });
});
app.post('/api/market/orders', async (c) => {
  market(c);
  const { idempotency_key, ...payload } = sellSchema.parse(await jsonBody(c));
  const db = c.get('db'),
    season = await currentSeason(db);
  return c.json(
    await command(db, c.get('user').id, season.id, 'sell', payload, idempotency_key, c.get('now')),
  );
});
for (const op of ['buy', 'cancel'] as const)
  app.post(`/api/market/orders/:id/${op}`, async (c) => {
    market(c);
    const { idempotency_key } = keySchema.parse(await jsonBody(c));
    const db = c.get('db'),
      season = await currentSeason(db);
    return c.json(
      await command(
        db,
        c.get('user').id,
        season.id,
        op,
        { order_id: id.parse(c.req.param('id')) },
        idempotency_key,
        c.get('now'),
      ),
    );
  });
const landTrading = (c: Ctx) => {
  if (c.env.LAND_TRADING_ENABLED !== 'true') throw new ApiError('FEATURE_DISABLED', 404);
};
app.get('/api/land/listings', async (c) => {
  landTrading(c);
  const db = c.get('db'),
    season = await currentSeason(db);
  const cursor = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .parse(c.req.query('offset') || 0);
  const listings = await db.all(
    `SELECT l.id,l.territory_id,t.region_id,l.seller_user_id,p.display_name AS seller_name,l.price_gold,l.created_at
    FROM land_listings l JOIN territories t ON t.id=l.territory_id JOIN profiles p ON p.user_id=l.seller_user_id JOIN users u ON u.id=l.seller_user_id
    WHERE l.season_id=? AND l.status='open' AND u.status='active' ORDER BY l.created_at DESC,l.id LIMIT 51 OFFSET ?`,
    season.id,
    cursor,
  );
  return c.json({
    listings: listings.slice(0, 50),
    next_offset: listings.length > 50 ? cursor + 50 : null,
  });
});
for (const op of ['list', 'unlist', 'buy'] as const)
  app.post(`/api/land/:id/${op}`, async (c) => {
    landTrading(c);
    const body = await jsonBody(c);
    const { idempotency_key, ...price } =
      op === 'unlist' ? keySchema.parse(body) : landPriceSchema.parse(body);
    const db = c.get('db'),
      season = await currentSeason(db),
      territory_id = id.parse(c.req.param('id'));
    if (op === 'buy') {
      // Pay the outgoing owner's production up to now before the plot changes hands.
      const owner = await db.first<{ id: string }>(
        "SELECT u.id FROM territories t JOIN users u ON u.id=t.owner_user_id WHERE t.id=? AND u.status='active' AND u.id<>?",
        territory_id,
        c.get('user').id,
      );
      if (owner)
        await command(
          db,
          owner.id,
          season.id,
          'settle',
          {},
          `settle:land:${crypto.randomUUID()}`,
          c.get('now'),
        );
    }
    return c.json(
      await command(
        db,
        c.get('user').id,
        season.id,
        op === 'list' ? 'sell' : op === 'unlist' ? 'cancel' : 'buy',
        { territory_id, ...price },
        idempotency_key,
        c.get('now'),
      ),
    );
  });
app.post('/api/events', async (c) => {
  const { event } = z
    .object({ event: z.enum(['visit', 'map', 'territory']) })
    .strict()
    .parse(await jsonBody(c));
  await c
    .get('db')
    .run(
      'INSERT OR IGNORE INTO visits VALUES(?,?,?)',
      c.get('user').id,
      new Date(c.get('now') * 1000).toISOString().slice(0, 10),
      event,
    );
  return c.json({ ok: true });
});
app.post('/api/reports', async (c) => {
  const body = reportSchema.parse(await jsonBody(c));
  const db = c.get('db');
  const target = await db.first(
    `SELECT id FROM ${body.target_type === 'territory' ? 'territories' : 'market_orders'} WHERE id=?`,
    body.target_id,
  );
  if (!target) throw new ApiError('NOT_FOUND', 404);
  await limit(c, `report:${c.get('user').id}`, 5, 3600);
  await db.run(
    'INSERT INTO reports(id,reporter_user_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?,?)',
    crypto.randomUUID(),
    c.get('user').id,
    body.target_type,
    body.target_id,
    body.reason,
    c.get('now'),
  );
  return c.json({ ok: true });
});
app.use('/api/admin/*', async (c, next) => {
  if (c.get('user').role !== 'admin') throw new ApiError('FORBIDDEN', 403);
  await next();
});
app.get('/api/admin/metrics', async (c) => {
  const db = c.get('db'),
    season = (await currentSeason(db)).id;
  const [metrics, users, economy, reports, retention, engagement] = await Promise.all([
    db.all("SELECT * FROM daily_metrics WHERE day>=date('now','-7 days') ORDER BY day DESC,route"),
    db.all('SELECT is_test,COUNT(*) AS count FROM users GROUP BY is_test'),
    db.first(
      `SELECT (SELECT COALESCE(SUM(gold_balance),0) FROM player_state WHERE season_id=?) AS gold_supply,(SELECT COALESCE(SUM(tax_gold),0) FROM trade_ledger WHERE season_id=?) AS tax_burned,(SELECT COALESCE(SUM(quantity),0) FROM market_orders WHERE season_id=? AND status='open') AS escrow`,
      season,
      season,
      season,
    ),
    db.all(
      "SELECT r.*,p.display_name AS reporter_name FROM reports r JOIN profiles p ON p.user_id=r.reporter_user_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 100",
    ),
    db.all(
      `SELECT u.is_test,COUNT(*) AS cohort,SUM(CASE WHEN EXISTS(SELECT 1 FROM visits v WHERE v.user_id=u.id AND v.event='visit' AND v.day=date(u.created_at,'unixepoch','+1 day')) THEN 1 ELSE 0 END) AS d1_returned,SUM(CASE WHEN u.created_at<=unixepoch()-604800 THEN 1 ELSE 0 END) AS d7_eligible,SUM(CASE WHEN EXISTS(SELECT 1 FROM visits v WHERE v.user_id=u.id AND v.event='visit' AND v.day=date(u.created_at,'unixepoch','+7 days')) THEN 1 ELSE 0 END) AS d7_returned FROM users u WHERE u.created_at<=unixepoch()-86400 GROUP BY u.is_test`,
    ),
    db.all(
      `SELECT u.is_test,COUNT(DISTINCT a.user_id) AS weekly_active,COUNT(CASE WHEN a.type='claim' THEN 1 END) AS claims,COUNT(CASE WHEN a.type='buy' THEN 1 END) AS trades FROM actions a JOIN users u ON u.id=a.user_id WHERE a.created_at>=unixepoch()-604800 AND a.type IN ('claim','build','sell','buy','cancel') GROUP BY u.is_test`,
    ),
  ]);
  return c.json({ metrics, users, economy, reports, retention, engagement });
});
app.post('/api/admin/reports/:id', async (c) => {
  z.object({ status: z.literal('resolved') })
    .strict()
    .parse(await jsonBody(c));
  const row = await c
    .get('db')
    .first(
      "UPDATE reports SET status='resolved',resolved_by=? WHERE id=? RETURNING id",
      c.get('user').id,
      id.parse(c.req.param('id')),
    );
  if (!row) throw new ApiError('NOT_FOUND', 404);
  return c.json({ ok: true });
});
app.get('/api/store/catalog', (c) =>
  c.json({
    enabled: false,
    packs: [
      { sku: 'starter', usd_cents: 100, gems: 100 },
      { sku: 'builder', usd_cents: 1000, gems: 1100 },
      { sku: 'founder', usd_cents: 10000, gems: 12000 },
    ],
    cosmetics: ['fern', 'ocean', 'sunset'],
  }),
);
for (const path of ['/api/payments/checkout', '/api/payments/webhook', '/api/actions/attack'])
  app.all(path, () => {
    throw new ApiError('FEATURE_DISABLED', 404);
  });
app.all('/api/*', () => {
  throw new ApiError('NOT_FOUND', 404);
});
app.get('*', (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('WORLD API')));

app.onError((error, c) => {
  if (error instanceof ApiError)
    return c.json({ error: { code: error.code } }, error.status as 400);
  if (error instanceof ZodError) return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
  const codes = [
    'ACCOUNT_BLOCKED',
    'SEASON_ENDED',
    'NOT_JOINED',
    'ALREADY_JOINED',
    'REGION_FULL',
    'TERRITORY_UNAVAILABLE',
    'NOT_ADJACENT',
    'NO_ENERGY',
    'CANNOT_BUILD',
    'INSUFFICIENT_FUNDS',
    'INSUFFICIENT_RESOURCES',
    'ORDER_UNAVAILABLE',
    'SELF_TRADE',
    'ORDER_LIMIT',
    'TRADE_COOLDOWN',
    'NOT_OWNER',
    'ALREADY_LISTED',
    'ABOVE_BUYOUT_PRICE',
    'LISTING_UNAVAILABLE',
    'PRICE_CHANGED',
    'PROTECTED',
    'BUYOUT_COOLDOWN',
  ];
  const code = codes.find((code) => error.message.includes(code));
  if (code) return c.json({ error: { code } }, 409);
  console.error(JSON.stringify({ error: 'INTERNAL_ERROR', name: error.name }));
  return c.json({ error: { code: 'INTERNAL_ERROR' } }, 500);
});
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const db = new Db(env.DB),
          now = Math.floor(Date.now() / 1000);
        const season = await currentSeason(db);
        await snapshot(db, season.id, now, true);
        await db.batch([
          db.statement('DELETE FROM sessions WHERE expires_at<?', [now]),
          db.statement('DELETE FROM oauth_attempts WHERE expires_at<?', [now]),
          db.statement('DELETE FROM rate_limits WHERE expires_at<?', [now]),
          db.statement("DELETE FROM daily_metrics WHERE day<date('now','-90 days')"),
        ]);
      })(),
    );
  },
};
