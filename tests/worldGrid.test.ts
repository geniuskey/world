import { describe, expect, it } from 'vitest';
import {
  rootTile,
  rootTileAt,
  worldTileFromId,
  visibleWorldTiles,
  worldTilesForView,
  childTiles,
  WORLD_INITIAL_TILES,
  WORLD_MAX_LEVEL,
  WORLD_VIEW_LIMIT,
  worldTileName,
  worldTileAt,
} from '../shared/worldGrid';

describe('hierarchical million-tile world', () => {
  const area = (t: { west: number; east: number; south: number; north: number }) =>
    (t.east - t.west) * (t.north - t.south);
  it('covers Earth with exactly 1,048,576 roots without allocating them all', () => {
    expect(WORLD_INITIAL_TILES).toBe(1_048_576);
    expect(rootTile(0, 0)).toMatchObject({ west: -180, south: -90 });
    expect(rootTile(1023, 1023)).toMatchObject({ east: 180, north: 90 });
    expect(area(rootTile(0, 0)) * WORLD_INITIAL_TILES).toBe(360 * 180);
    for (let lat = -89.9; lat < 90; lat += 7.13)
      for (let lon = -179.9; lon < 180; lon += 9.17) {
        const tile = rootTileAt(lon, lat);
        expect(tile.west).toBeLessThanOrEqual(lon);
        expect(tile.east).toBeGreaterThan(lon);
        expect(tile.south).toBeLessThanOrEqual(lat);
        expect(tile.north).toBeGreaterThan(lat);
        expect(worldTileFromId(tile.id)).toEqual(tile);
      }
    expect(rootTileAt(180, 90).id).toBe('earth2:0:1023');
    expect(rootTileAt(540, -90).id).toBe('earth2:0:0');
    expect(worldTileFromId('earth2:1024:0')).toBeNull();
    expect(worldTileFromId('earth2:000:0')).toBeNull();
    expect(worldTileFromId('earth:8:4')).toBeNull();
  });
  it('bounds world overview output and returns exact root tiles on zoom', () => {
    const overview = visibleWorldTiles({ west: -180, south: -90, east: 180, north: 90 });
    expect(overview.tiles.length).toBeLessThanOrEqual(WORLD_VIEW_LIMIT);
    expect(overview.tiles.reduce((sum, t) => sum + area(t), 0)).toBe(360 * 180);
    expect(overview.stride).toBeGreaterThan(1);
    const root = rootTileAt(127, 37.5);
    const detail = visibleWorldTiles(root);
    expect(detail.stride).toBe(1);
    expect(detail.tiles).toEqual([root]);
    const bounds = { west: 124, east: 131, south: 33, north: 40 };
    const viewport = visibleWorldTiles(bounds);
    expect(viewport.stride).toBe(1);
    expect(viewport.tiles.length).toBeLessThanOrEqual(WORLD_VIEW_LIMIT);
    expect(viewport.tiles.some((t) => t.id === root.id)).toBe(true);
  });
  it('subdivides without gaps or overlaps and keeps stable paths', () => {
    for (const root of [rootTile(0, 0), rootTile(1023, 1023), rootTileAt(127, 37.5)]) {
      const children = childTiles(root);
      expect(children).toHaveLength(4);
      expect(children.reduce((sum, t) => sum + area(t), 0)).toBe(area(root));
      for (const child of children) expect(worldTileFromId(child.id)).toEqual(child);
      const grandchild = childTiles(children[3])[2];
      expect(worldTileFromId(grandchild.id)).toEqual(grandchild);
    }
    expect(childTiles({ ...rootTile(0, 0), level: WORLD_MAX_LEVEL })).toEqual([]);
  });
  it('fills an expanded view immediately with stale or missing server tiles', () => {
    const previous = visibleWorldTiles(rootTileAt(127, 37.5)).tiles;
    const bounds = { west: 120, east: 134, south: 30, north: 45 };
    const expected = visibleWorldTiles(bounds);
    expect(worldTilesForView(bounds, previous)).toEqual(expected);
    expect(worldTilesForView(bounds)).toEqual(expected);
  });
  it('covers date-line views and wrapped longitudes within the display budget', () => {
    for (const west of [179, -181, 539]) {
      const view = worldTilesForView({ west, east: west + 2, south: -1, north: 1 });
      expect(view.tiles.reduce((sum, tile) => sum + area(tile), 0)).toBeGreaterThanOrEqual(4);
      expect(view.tiles.some((tile) => tile.west === -180)).toBe(true);
      expect(view.tiles.some((tile) => tile.east === 180)).toBe(true);
      expect(view.tiles.length).toBeLessThanOrEqual(WORLD_VIEW_LIMIT);
    }
    const overview = worldTilesForView({ west: -200, east: 200, south: -90, north: 90 });
    expect(overview.tiles.reduce((sum, tile) => sum + area(tile), 0)).toBe(360 * 180);
    expect(overview.tiles.length).toBeLessThanOrEqual(WORLD_VIEW_LIMIT);
  });
  it('preserves complete loaded subdivisions and fills incomplete ones with their parent', () => {
    const root = rootTileAt(127, 37.5);
    const children = childTiles(root);
    const leaves = [...children.slice(0, 3), ...childTiles(children[3])];
    expect(worldTilesForView(root, leaves).tiles).toEqual(leaves);
    expect(worldTilesForView(root, children.slice(0, 3)).tiles).toEqual([root]);
    const overview = worldTilesForView({ west: -180, east: 180, south: -90, north: 90 }, leaves);
    expect(overview.tiles.every((tile) => tile.level < 0)).toBe(true);
    expect(overview.tiles.length).toBeLessThanOrEqual(WORLD_VIEW_LIMIT);
  });
  it('gives all million roots unique stable names', () => {
    const names = new Set<string>();
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 1024; x++) names.add(worldTileName(rootTile(x, y)));
    expect(names.size).toBe(WORLD_INITIAL_TILES);
  });
  it.each(['en', 'ko'])('keeps subdivision names distinct from ancestors in %s', (locale) => {
    let level = [rootTileAt(127, 37.5)];
    const names: string[] = [];
    for (let depth = 0; depth <= WORLD_MAX_LEVEL; depth++) {
      for (const tile of level) {
        const name = worldTileName(tile, locale);
        names.push(name);
        expect(worldTileName(worldTileFromId(tile.id)!, locale)).toBe(name);
      }
      level = level.flatMap(childTiles);
    }
    expect(new Set(names).size).toBe(names.length);
    expect(worldTileName(rootTileAt(127, 37.5), 'ko')).toMatch(/[가-힣]/);
  });
  it('resolves clicks to the deepest visible region and falls back outside loaded bounds', () => {
    const root = rootTileAt(127, 37.5);
    const child = childTiles(root)[3];
    const leaf = childTiles(child)[0];
    const lng = (leaf.west + leaf.east) / 2;
    const lat = (leaf.south + leaf.north) / 2;
    expect(worldTileAt(lng, lat, [leaf, child, root])).toEqual(leaf);
    expect(worldTileAt(lng + 360, lat, [root, child, leaf])).toEqual(leaf);
    expect(worldTileAt(-120, -30, [root, child, leaf])).toEqual(rootTileAt(-120, -30));
    expect(worldTileAt(0, 90, [])).toEqual(rootTileAt(0, 90));
    expect(worldTileAt(180, 0, [])).toEqual(rootTileAt(-180, 0));
  });
});
