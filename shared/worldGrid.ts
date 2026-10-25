import type { Region } from './game';

// Versioned IDs keep the earlier coarse grid and its existing saves intact.
export const WORLD_COLUMNS = 1024;
export const WORLD_ROWS = 1024;
export const WORLD_INITIAL_TILES = WORLD_COLUMNS * WORLD_ROWS;
export const WORLD_SPLIT_PLAYERS = 8;
export const WORLD_MAX_LEVEL = 6;
export const WORLD_REGION_SIZE = 8;
export const WORLD_VIEW_LIMIT = 2048;
export type WorldBounds = { west: number; south: number; east: number; north: number };
export type WorldTile = WorldBounds & {
  id: string;
  parent_id: string | null;
  level: number;
  split: number;
  population: number;
};
export function rootTile(x: number, y: number): WorldTile {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    x >= WORLD_COLUMNS ||
    y < 0 ||
    y >= WORLD_ROWS
  )
    throw new RangeError('Invalid world tile');
  return {
    id: `earth2:${x}:${y}`,
    parent_id: null,
    level: 0,
    west: -180 + (x * 360) / WORLD_COLUMNS,
    east: -180 + ((x + 1) * 360) / WORLD_COLUMNS,
    south: -90 + (y * 180) / WORLD_ROWS,
    north: -90 + ((y + 1) * 180) / WORLD_ROWS,
    split: 0,
    population: 0,
  };
}
export function rootTileAt(longitude: number, latitude: number): WorldTile {
  const lon = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return rootTile(
    Math.floor(((lon + 180) / 360) * WORLD_COLUMNS),
    Math.min(WORLD_ROWS - 1, Math.max(0, Math.floor(((latitude + 90) / 180) * WORLD_ROWS))),
  );
}
export function childTiles(tile: WorldTile): WorldTile[] {
  if (tile.level >= WORLD_MAX_LEVEL) return [];
  const midX = (tile.west + tile.east) / 2,
    midY = (tile.south + tile.north) / 2;
  return Array.from({ length: 4 }, (_, i) => ({
    id: `${tile.id}:${i}`,
    parent_id: tile.id,
    level: tile.level + 1,
    west: i % 2 ? midX : tile.west,
    east: i % 2 ? tile.east : midX,
    south: i < 2 ? tile.south : midY,
    north: i < 2 ? midY : tile.north,
    split: 0,
    population: 0,
  }));
}
export function worldTileFromId(id: string): WorldTile | null {
  if (!/^earth2:\d{1,4}:\d{1,4}(?::[0-3]){0,6}$/.test(id)) return null;
  const [, x, y, ...path] = id.split(':');
  if (+x >= WORLD_COLUMNS || +y >= WORLD_ROWS) return null;
  let tile = rootTile(+x, +y);
  for (const child of path) tile = childTiles(tile)[+child];
  return tile.id === id ? tile : null;
}
// Select a bounded level of detail. Overview cells are display groups, never settlement IDs.
export function visibleWorldTiles(bounds: WorldBounds, limit = WORLD_VIEW_LIMIT) {
  const west = Math.max(-180, Math.min(180, bounds.west));
  const east = Math.max(west, Math.min(180, bounds.east));
  const south = Math.max(-90, Math.min(90, bounds.south));
  const north = Math.max(south, Math.min(90, bounds.north));
  const x0 = Math.min(1023, Math.floor(((west + 180) / 360) * WORLD_COLUMNS));
  const x1 = Math.min(1023, Math.ceil(((east + 180) / 360) * WORLD_COLUMNS) - 1);
  const y0 = Math.min(1023, Math.floor(((south + 90) / 180) * WORLD_ROWS));
  const y1 = Math.min(1023, Math.ceil(((north + 90) / 180) * WORLD_ROWS) - 1);
  let stride = 1;
  while (
    (Math.floor(x1 / stride) - Math.floor(x0 / stride) + 1) *
      (Math.floor(y1 / stride) - Math.floor(y0 / stride) + 1) >
    limit
  )
    stride *= 2;
  const tiles: WorldTile[] = [];
  for (let y = Math.floor(y0 / stride) * stride; y <= y1; y += stride)
    for (let x = Math.floor(x0 / stride) * stride; x <= x1; x += stride) {
      const tile = rootTile(x, y);
      if (stride > 1) {
        tile.id = `overview:${x}:${y}:${stride}`;
        tile.east = rootTile(Math.min(1023, x + stride - 1), y).east;
        tile.north = rootTile(x, Math.min(1023, y + stride - 1)).north;
        tile.level = -Math.log2(stride);
      }
      tiles.push(tile);
    }
  return { tiles, stride };
}
export function regionForTile(tile: WorldTile, season: string): Region {
  return {
    id: tile.id,
    season_id: season,
    name: `${((tile.south + tile.north) / 2).toFixed(3)}°, ${((tile.west + tile.east) / 2).toFixed(3)}°`,
    subtitle: `Level ${tile.level}`,
    longitude: (tile.west + tile.east) / 2,
    latitude: (tile.south + tile.north) / 2,
    width: WORLD_REGION_SIZE,
    height: WORLD_REGION_SIZE,
    map_version: 1,
    world_split: tile.split,
    world_level: tile.level,
    parent_id: tile.parent_id,
    owned: 0,
    available: WORLD_REGION_SIZE ** 2,
  };
}
