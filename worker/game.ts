import { prepareSettlement, splitTile, worldTile } from './world';
import { ApiError } from './types';
import type { Db } from './db';
import {
  TURN_SECONDS,
  type Season,
  type Territory,
  type Player,
  type PlayerState,
  type Rank,
  type ResourceKind,
} from '../shared/game';

type Action = { id: string; type: string; payload_json: string; result_json: string };
export async function currentSeason(db: Db) {
  const season = await db.first<Season>("SELECT * FROM seasons WHERE status='active' LIMIT 1");
  if (!season) throw new ApiError('NO_SEASON', 503);
  return season;
}
function actionStatement(
  db: Db,
  user: string,
  season: string,
  type: string,
  payload: string,
  key: string,
  now: number,
  actionId = crypto.randomUUID(),
) {
  return db.statement(
    'INSERT INTO actions(id,user_id,season_id,type,payload_json,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?)',
    [actionId, user, season, type, payload, key, now],
  );
}
export async function command(
  db: Db,
  user: string,
  season: string,
  type: string,
  payload: Record<string, unknown>,
  key: string,
  now: number,
) {
  const json = JSON.stringify(payload);
  const replay = (a: Action) => {
    if (a.type !== type || a.payload_json !== json) throw new ApiError('IDEMPOTENCY_CONFLICT', 409);
    return { action_id: a.id, result: JSON.parse(a.result_json), replayed: true };
  };
  const prior = await db.first<Action>(
    'SELECT id,type,payload_json,result_json FROM actions WHERE user_id=? AND idempotency_key=?',
    user,
    key,
  );
  if (prior) return replay(prior);
  const actionId = crypto.randomUUID();
  try {
    const statements = [];
    if (type !== 'join' && type !== 'settle')
      statements.push(actionStatement(db, user, season, 'settle', '{}', `settle:${actionId}`, now));
    statements.push(actionStatement(db, user, season, type, json, key, now, actionId));
    await db.batch(statements);
  } catch (error) {
    // A concurrent identical request may have committed while this one waited.
    const raced = await db.first<Action>(
      'SELECT id,type,payload_json,result_json FROM actions WHERE user_id=? AND idempotency_key=?',
      user,
      key,
    );
    if (raced) return replay(raced);
    throw error;
  }
  const action = await db.first<Action>(
    'SELECT id,type,payload_json,result_json FROM actions WHERE id=?',
    actionId,
  );
  return { action_id: actionId, result: JSON.parse(action!.result_json), replayed: false };
}
export async function join(db: Db, user: string, region: string, now: number, autoSplit = false) {
  const season = await currentSeason(db);
  const existing = await db.first(
    'SELECT user_id FROM player_state WHERE user_id=? AND season_id=?',
    user,
    season.id,
  );
  if (!existing) {
    if (now < season.begins_at || now >= season.ends_at) throw new ApiError('SEASON_ENDED', 409);
    const target = await prepareSettlement(db, season.id, region, autoSplit);
    await command(db, user, season.id, 'join', { region_id: target }, `join:${season.id}`, now);
    const tile = await worldTile(db, season.id, target);
    if (tile && autoSplit) await splitTile(db, season.id, tile);
  }
}
export async function playerState(db: Db, user: Player, now: number): Promise<PlayerState> {
  const season = await currentSeason(db);
  let state = await db.first<{
    energy_value: number;
    energy_updated_at: number;
    gold_balance: number;
    territory_count: number;
    produced_total: number;
  }>('SELECT * FROM player_state WHERE user_id=? AND season_id=?', user.id, season.id);
  if (!state) throw new ApiError('NOT_JOINED', 409);
  let territories = await db.all<Territory & { production_at: number }>(
    'SELECT t.*,p.population,p.year AS population_year,p.source AS population_source FROM territories t LEFT JOIN territory_population p ON p.territory_id=t.id WHERE owner_user_id=? AND season_id=? ORDER BY acquired_at,t.id LIMIT 65536',
    user.id,
    season.id,
  );
  if (
    now < season.ends_at &&
    ((state.energy_value < 4 && now - state.energy_updated_at >= TURN_SECONDS) ||
      territories.some((t) => now - t.production_at >= TURN_SECONDS))
  ) {
    await command(db, user.id, season.id, 'settle', {}, `settle:read:${crypto.randomUUID()}`, now);
    state = (await db.first<typeof state>(
      'SELECT * FROM player_state WHERE user_id=? AND season_id=?',
      user.id,
      season.id,
    ))!;
    territories = await db.all<Territory & { production_at: number }>(
      'SELECT t.*,p.population,p.year AS population_year,p.source AS population_source FROM territories t LEFT JOIN territory_population p ON p.territory_id=t.id WHERE owner_user_id=? AND season_id=? ORDER BY acquired_at,t.id LIMIT 65536',
      user.id,
      season.id,
    );
  }
  const resources = Object.fromEntries(
    (
      await db.all<{ kind: ResourceKind; quantity: number }>(
        'SELECT kind,quantity FROM resources WHERE user_id=? AND season_id=?',
        user.id,
        season.id,
      )
    ).map((r) => [r.kind, r.quantity]),
  ) as Record<ResourceKind, number>;
  const production = { food: 0, wood: 0, iron: 0 };
  for (const t of territories)
    if (t.terrain_type !== 'water')
      production[
        t.terrain_type === 'meadow' ? 'food' : t.terrain_type === 'forest' ? 'wood' : 'iron'
      ] += t.structure_type ? 4 : 2;
  const achievements = await db.all<{ kind: string; earned_at: number; season_id: string }>(
    'SELECT kind,earned_at,season_id FROM achievements WHERE user_id=?',
    user.id,
  );
  return {
    ...state,
    user,
    season,
    resources,
    territories,
    production,
    achievements,
    next_energy_at: state.energy_value < 4 ? state.energy_updated_at + TURN_SECONDS : null,
  };
}
export async function snapshot(db: Db, season: string, now: number, force = false) {
  const prior = await db.first<{ generated_at: number; rows_json: string }>(
    'SELECT * FROM leaderboard_snapshots WHERE season_id=?',
    season,
  );
  if (prior && !force && now - prior.generated_at < 3600)
    return { generated_at: prior.generated_at, rows: JSON.parse(prior.rows_json) as Rank[] };
  const rows = await db.all<Rank>(
    `SELECT p.user_id,f.display_name,p.territory_count,p.produced_total,u.is_test,
    2*p.territory_count+2*(SELECT COUNT(*) FROM territories t WHERE t.owner_user_id=p.user_id AND t.season_id=p.season_id AND t.structure_type IS NOT NULL) AS production_rate,
    10*p.territory_count+p.produced_total AS score FROM player_state p JOIN profiles f ON f.user_id=p.user_id JOIN users u ON u.id=p.user_id
    WHERE p.season_id=? AND u.status='active' ORDER BY score DESC,p.user_id LIMIT 100`,
    season,
  );
  await db.run(
    'INSERT INTO leaderboard_snapshots VALUES(?,?,?) ON CONFLICT(season_id) DO UPDATE SET generated_at=excluded.generated_at,rows_json=excluded.rows_json',
    season,
    now,
    JSON.stringify(rows),
  );
  return { generated_at: now, rows };
}
