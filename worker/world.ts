import type { Db } from './db';
import type { Territory } from '../shared/game';
import {
  visibleWorldTiles,
  WORLD_INITIAL_TILES,
  WORLD_VIEW_LIMIT,
  type WorldBounds,
  childTiles,
  WORLD_REGION_SIZE,
  type WorldTile,
} from '../shared/worldGrid';
import { ApiError } from './types';
import { isPlotRegion, plotRegion, plotRegionFromId, REGION_PLOTS } from '../shared/plots';

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
export function virtualTerritories(season: string, region: string): Territory[] {
  const plots = plotRegionFromId(region);
  const bx = plots ? plots.x * REGION_PLOTS : 0,
    by = plots ? plots.y * REGION_PLOTS : 0;
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
      gx: plots ? bx + x : null,
      gy: plots ? by + y : null,
      cx: 0,
      cy: 0,
      terrain_type: terrain[((bx + x) * 17 + (by + y) * 31) % 3],
      owner_user_id: null,
      acquired_at: null,
      version: 1,
      structure_type: null,
      is_starter: (bx + x) % 2 === 0 && (by + y) % 2 === 0 ? 1 : 0,
    };
  });
}
// A region that can be previewed: any plot region, or an allocated version 1 region.
export async function regionExists(db: Db, season: string, id: string) {
  return (
    isPlotRegion(id) ||
    Boolean(await db.first('SELECT id FROM regions WHERE id=? AND season_id=?', id, season))
  );
}
// Allocate a plot region's 64 rows only when someone first settles or claims there.
// New settlement uses only plot regions; version 1 world tiles are archived.
export async function prepareSettlement(db: Db, season: string, requested: string) {
  const region = plotRegion(requested, season);
  if (!region) {
    // Version 1 regions are all archived by migration 0012; only allocated open ones remain usable.
    if (
      await db.first(
        "SELECT id FROM regions WHERE id=? AND season_id=? AND status='open'",
        requested,
        season,
      )
    )
      return requested;
    throw new ApiError('NOT_FOUND', 404);
  }
  if (
    await db.first(
      'SELECT version FROM chunk_versions WHERE season_id=? AND region_id=? AND cx=0 AND cy=0',
      season,
      requested,
    )
  )
    return requested;
  await db.batch([
    db.statement(
      `INSERT OR IGNORE INTO regions(id,season_id,name,subtitle,longitude,latitude,width,height,land_count)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        region.id,
        season,
        region.name,
        region.subtitle,
        region.longitude,
        region.latitude,
        region.width,
        region.height,
        region.width * region.height,
      ],
    ),
    db.statement('INSERT OR IGNORE INTO chunk_versions VALUES(?,?,0,0,1)', [season, requested]),
    ...virtualTerritories(season, requested).map((t) =>
      db.statement(
        `INSERT OR IGNORE INTO territories
        (id,region_id,season_id,x,y,gx,gy,cx,cy,terrain_type,is_starter) VALUES(?,?,?,?,?,?,?,0,0,?,?)`,
        [t.id, requested, season, t.x, t.y, t.gx, t.gy, t.terrain_type, t.is_starter],
      ),
    ),
  ]);
  return requested;
}
