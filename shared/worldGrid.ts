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

const regionWords = {
  en: {
    adjectives: [
      'Silver',
      'Golden',
      'Quiet',
      'Misty',
      'Amber',
      'Azure',
      'Jade',
      'Hidden',
      'Dawn',
      'Moonlit',
      'Starry',
      'Verdant',
      'Crimson',
      'Crystal',
      'Gentle',
      'Bright',
    ],
    nouns: [
      'Grove',
      'Vale',
      'Reach',
      'Haven',
      'Field',
      'Crest',
      'Hollow',
      'Garden',
      'Meadow',
      'Ridge',
      'Spring',
      'Glade',
      'Shore',
      'Basin',
      'Heath',
      'Vista',
    ],
  },
  ko: {
    adjectives: [
      '은빛',
      '금빛',
      '고요한',
      '안개 낀',
      '호박빛',
      '푸른',
      '비취빛',
      '숨은',
      '새벽',
      '달빛',
      '별빛',
      '초록',
      '진홍빛',
      '수정빛',
      '포근한',
      '환한',
    ],
    nouns: [
      '숲',
      '골짜기',
      '벌판',
      '쉼터',
      '들녘',
      '마루',
      '분지',
      '정원',
      '초원',
      '능선',
      '샘',
      '숲터',
      '물가',
      '터전',
      '언덕',
      '풍경',
    ],
  },
};

// The coordinate code is lossless, including the subdivision path: names remain
// unique at every level and stable across sessions, seasons, and loaded data.
export function worldTileName(tile: WorldTile, locale = 'en'): string {
  const [, x, y, ...path] = tile.id.split(':');
  const words = locale === 'ko' ? regionWords.ko : regionWords.en;
  const code = `${x}-${y}${path.map((child) => `/${Number(child) + 1}`).join('')}`;
  return `${words.adjectives[(Number(x) + Number(y) * 7) % 16]} ${words.nouns[(Number(y) + Math.floor(Number(x) / 16)) % 16]} · ${code}`;
}

export function worldTileAt(longitude: number, latitude: number, tiles: WorldTile[]): WorldTile {
  const root = rootTileAt(longitude, latitude);
  const lon = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return tiles.reduce(
    (best, tile) =>
      tile.level >= best.level &&
      tile.level >= 0 &&
      lon >= tile.west &&
      lon < tile.east &&
      latitude >= tile.south &&
      (latitude < tile.north || (latitude === 90 && tile.north === 90))
        ? tile
        : best,
    root,
  );
}
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
// Geometry is available locally, so moving the camera must not wait for the API.
// Server tiles refine complete subdivisions without leaving gaps at fetched edges.
export function worldTilesForView(bounds: WorldBounds, loaded: WorldTile[] = []) {
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
  const display = new Map(views.flatMap((view) => view.tiles).map((tile) => [tile.id, tile]));
  const stride = Math.max(...views.map((view) => view.stride));
  if (stride > 1) return { tiles: [...display.values()], stride };

  const known = new Map<string, WorldTile>();
  const split = new Set<string>();
  for (const tile of loaded) {
    if (tile.level < 0) continue;
    known.set(tile.id, tile);
    let parentId = tile.parent_id;
    while (parentId) {
      const parent = worldTileFromId(parentId);
      if (!parent) break;
      if (!known.has(parentId)) known.set(parentId, parent);
      split.add(parentId);
      parentId = parent.parent_id;
    }
  }
  const visit = (tile: WorldTile) => {
    const saved = known.get(tile.id) ?? tile;
    const children = split.has(tile.id) ? childTiles(saved) : [];
    if (
      children.length === 4 &&
      children.every((child) => known.has(child.id)) &&
      display.size + 3 <= WORLD_VIEW_LIMIT
    ) {
      display.delete(tile.id);
      for (const child of children) {
        display.set(child.id, child);
        visit(child);
      }
    } else display.set(tile.id, saved);
  };
  for (const tile of [...display.values()]) visit(tile);
  return { tiles: [...display.values()], stride };
}
export function regionForTile(tile: WorldTile, season: string): Region {
  return {
    id: tile.id,
    season_id: season,
    name: worldTileName(tile),
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
