import type { Db } from './db';
import type { Territory } from '../shared/game';
import {
  visibleWorldTiles,
  worldTileFromId,
  regionForTile,
  WORLD_INITIAL_TILES,
  WORLD_VIEW_LIMIT,
  type WorldBounds,
  childTiles,
  WORLD_REGION_SIZE,
  WORLD_SPLIT_PLAYERS,
  WORLD_MAX_LEVEL,
  type WorldTile,
} from '../shared/worldGrid';
import { ApiError } from './types';

function insertTile(db: Db, season: string, tile: WorldTile) {
  const region = regionForTile(tile, season);
  return [
    db.statement(
      `INSERT OR IGNORE INTO regions(id,season_id,name,subtitle,longitude,latitude,width,height,land_count)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        tile.id,
        season,
        region.name,
        `Level ${tile.level}`,
        (tile.west + tile.east) / 2,
        (tile.south + tile.north) / 2,
        WORLD_REGION_SIZE,
        WORLD_REGION_SIZE,
        WORLD_REGION_SIZE ** 2,
      ],
    ),
    db.statement(
      `INSERT OR IGNORE INTO world_tiles(id,season_id,parent_id,level,west,south,east,north)
      VALUES(?,?,?,?,?,?,?,?)`,
      [tile.id, season, tile.parent_id, tile.level, tile.west, tile.south, tile.east, tile.north],
    ),
  ];
}
export async function worldTiles(
  db: Db,
  season: string,
  bounds: WorldBounds = { west: -180, south: -90, east: 180, north: 90 },
) {
  const width = Math.min(360, bounds.east - bounds.west);
  const west = width >= 360 ? -180 : ((((bounds.west + 180) % 360) + 360) % 360) - 180;
  const east = west + width;
  const ranges =
    east > 180
      ? [
          { ...bounds, west, east: 180 },
          { ...bounds, west: -180, east: east - 360 },
        ]
      : [{ ...bounds, west, east }];
  const views = ranges.map((range) => visibleWorldTiles(range, WORLD_VIEW_LIMIT / ranges.length));
  const display = new Map(views.flatMap((v) => v.tiles).map((t) => [t.id, t]));
  if (views.every((v) => v.stride === 1)) {
    const nodes = await db.all<WorldTile>(
      `SELECT w.*,
      (SELECT COUNT(DISTINCT owner_user_id) FROM territories t WHERE t.region_id=w.id AND t.season_id=w.season_id) AS population
      FROM world_tiles w WHERE w.season_id=? AND w.id LIKE 'earth2:%' AND w.north>? AND w.south<?
      AND ((w.east>? AND w.west<?) OR (w.east>? AND w.west<?)) ORDER BY w.level,w.id LIMIT ?`,
      season,
      bounds.south,
      bounds.north,
      ranges[0].west,
      ranges[0].east,
      ranges[1]?.west ?? ranges[0].west,
      ranges[1]?.east ?? ranges[0].east,
      WORLD_VIEW_LIMIT,
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const visit = (tile: WorldTile) => {
      const saved = byId.get(tile.id) ?? tile;
      const children = saved.split ? childTiles(saved).map((t) => byId.get(t.id)) : [];
      // Keep the parent visible if this view has reached its display budget.
      if (
        children.length === 4 &&
        children.every(Boolean) &&
        display.size + 3 <= WORLD_VIEW_LIMIT
      ) {
        display.delete(saved.id);
        for (const child of children) {
          display.set(child!.id, child!);
          visit(child!);
        }
      } else display.set(saved.id, saved);
    };
    for (const tile of [...display.values()]) visit(tile);
  }
  const splitCount = await db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM world_tiles WHERE season_id=? AND id LIKE 'earth2:%' AND split=1",
    season,
  );
  return {
    tiles: [...display.values()],
    stride: Math.max(...views.map((v) => v.stride)),
    total_tiles: WORLD_INITIAL_TILES + 3 * (splitCount?.n ?? 0),
  };
}
export async function worldTile(db: Db, season: string, id: string) {
  const saved = await db.first<WorldTile>(
    `SELECT w.*,
    (SELECT COUNT(DISTINCT owner_user_id) FROM territories t WHERE t.region_id=w.id AND t.season_id=w.season_id) AS population
    FROM world_tiles w WHERE w.id=? AND w.season_id=?`,
    id,
    season,
  );
  if (saved) return saved;
  const virtual = worldTileFromId(id);
  return virtual?.level === 0 ? virtual : null;
}

export async function splitTile(db: Db, season: string, tile: WorldTile) {
  if (tile.split || tile.level >= WORLD_MAX_LEVEL || tile.population < WORLD_SPLIT_PLAYERS) return;
  await db.batch([
    ...childTiles(tile).flatMap((child) => insertTile(db, season, child)),
    db.statement('UPDATE world_tiles SET split=1 WHERE id=? AND season_id=?', [tile.id, season]),
  ]);
}
export function virtualTerritories(season: string, region: string): Territory[] {
  return Array.from({ length: WORLD_REGION_SIZE ** 2 }, (_, i) => {
    const x = i % WORLD_REGION_SIZE,
      y = Math.floor(i / WORLD_REGION_SIZE);
    const terrain = ['meadow', 'forest', 'mountain'] as const;
    return {
      id: `${season}:${region}:${x}:${y}`,
      region_id: region,
      season_id: season,
      x,
      y,
      cx: 0,
      cy: 0,
      terrain_type: terrain[(x * 17 + y * 31) % 3],
      owner_user_id: null,
      acquired_at: null,
      version: 1,
      structure_type: null,
      is_starter: x % 2 === 0 && y % 2 === 0 ? 1 : 0,
    };
  });
}
export async function prepareSettlement(
  db: Db,
  season: string,
  requested: string,
  autoSplit = false,
): Promise<string> {
  let target = requested;
  for (let depth = 0; depth <= WORLD_MAX_LEVEL + 1; depth++) {
    const tile = await worldTile(db, season, target);
    if (!tile) {
      throw new ApiError('NOT_FOUND', 404);
    }
    if (autoSplit) await splitTile(db, season, tile);
    if (
      tile.split ||
      (autoSplit && tile.population >= WORLD_SPLIT_PLAYERS && tile.level < WORLD_MAX_LEVEL)
    ) {
      const child = await db.first<{ id: string }>(
        `SELECT w.id FROM world_tiles w
        WHERE w.parent_id=? AND w.season_id=? ORDER BY
        (SELECT COUNT(DISTINCT owner_user_id) FROM territories t WHERE t.season_id=w.season_id AND t.region_id IN
          (SELECT descendant.id FROM world_tiles descendant WHERE descendant.season_id=w.season_id
            AND (descendant.id=w.id OR descendant.id LIKE w.id || ':%'))),w.id LIMIT 1`,
        target,
        season,
      );
      if (!child) throw new ApiError('REGION_FULL', 409);
      target = child.id;
      continue;
    }
    // Allocate game plots only when someone actually settles here.
    if (
      await db.first(
        'SELECT version FROM chunk_versions WHERE season_id=? AND region_id=? AND cx=0 AND cy=0',
        season,
        target,
      )
    )
      return target;
    const tiles = virtualTerritories(season, target);
    await db.batch([
      ...insertTile(db, season, tile),
      db.statement('INSERT OR IGNORE INTO chunk_versions VALUES(?,?,0,0,1)', [season, target]),
      ...tiles.map((t) =>
        db.statement(
          `INSERT OR IGNORE INTO territories
        (id,region_id,season_id,x,y,cx,cy,terrain_type,is_starter) VALUES(?,?,?,?,?,0,0,?,?)`,
          [t.id, target, season, t.x, t.y, t.terrain_type, t.is_starter],
        ),
      ),
    ]);
    return target;
  }
  throw new ApiError('REGION_FULL', 409);
}
