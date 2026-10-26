import { describe, expect, it } from 'vitest';
import {
  measurementPath,
  measureDistance,
  readBookmarks,
  readMapLayers,
  regionLandmarks,
} from '../shared/mapFeatures';
import { virtualTerritories } from '../worker/world';

describe('map exploration tools', () => {
  it('validates persisted settings and removes duplicate or malformed bookmarks', () => {
    expect(
      readBookmarks(
        '["z14:13970:6344","z14:13970:6344","earth2:2:3","bad",null,"z14:16384:0","earth2:1024:3"]',
      ),
    ).toEqual(['z14:13970:6344', 'earth2:2:3']);
    expect(readBookmarks('invalid')).toEqual([]);
    expect(readBookmarks('{}')).toEqual([]);
    expect(readMapLayers('{"resources":"iron","population":true,"ownership":false}')).toMatchObject(
      { resources: 'iron', population: true, ownership: false },
    );
    expect(readMapLayers('{"resources":"bogus","landmarks":"true"}')).toMatchObject({
      resources: 'off',
      landmarks: false,
      ownership: true,
    });
    expect(readMapLayers('null').resources).toBe('off');
  });
  it('measures geodesic distance and bearing across the date line and poles', () => {
    expect(measureDistance([0, 0], [0, 0]).meters).toBe(0);
    expect(measureDistance([0, 0], [1, 0]).meters).toBeCloseTo(111195.08, 1);
    expect(measureDistance([0, 0], [1, 0]).bearing).toBeCloseTo(90);
    expect(measureDistance([0, 0], [0, 1]).bearing).toBeCloseTo(0);
    expect(measureDistance([179, 0], [-179, 0]).meters).toBeLessThan(223000);
    for (const [a, b] of [
      [
        [179, 0],
        [-179, 0],
      ],
      [
        [0, 89],
        [180, 89],
      ],
      [
        [0, 0],
        [180, 0],
      ],
    ] as [number[], number[]][]) {
      const path = measurementPath(a as [number, number], b as [number, number]);
      expect(path).toHaveLength(65);
      expect(path.every((point) => point.every(Number.isFinite))).toBe(true);
      expect(path[0][1]).toBeCloseTo(a[1]);
      expect(path.at(-1)![1]).toBeCloseTo(b[1]);
    }
    const path = measurementPath([179, 0], [-179, 0]);
    expect(path.at(-1)![0]).toBeCloseTo(181);
  });
  it('places deterministic landmarks only on matching terrain', () => {
    const tiles = virtualTerritories('s1', 'earth2:873:725');
    const landmarks = regionLandmarks(tiles);
    expect(landmarks.map((value) => value.kind)).toEqual(['peak', 'grove', 'ruins']);
    expect(regionLandmarks([...tiles].reverse())).toEqual(landmarks);
    expect(new Set(landmarks.map((value) => value.tile.id)).size).toBe(landmarks.length);
    expect(landmarks[0].tile.terrain_type).toBe('mountain');
    expect(regionLandmarks([])).toEqual([]);
  });
});
