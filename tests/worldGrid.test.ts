import { describe, expect, it } from 'vitest';
import {
  rootTile,
  rootTileAt,
  worldTileFromId,
  visibleWorldTiles,
  childTiles,
  WORLD_INITIAL_TILES,
  WORLD_MAX_LEVEL,
  WORLD_VIEW_LIMIT,
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
});
