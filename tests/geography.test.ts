import { describe, it, expect } from 'vitest';
import { coordinates, gridCell, gridPoint } from '../shared/geography';
import type { Region } from '../shared/game';

const region = (longitude: number, latitude: number) =>
  ({ longitude, latitude, width: 24, height: 24 }) as Region;
describe('geographic territory reference', () => {
  it.each([
    [127, 37.5],
    [-9.1, 38.7],
    [-87.6, 41.9],
  ])('anchors the grid to %s, %s and round-trips every cell', (longitude, latitude) => {
    const r = region(longitude, latitude);
    const center = gridPoint(r, 12, 12);
    expect(center[0]).toBeCloseTo(longitude, 8);
    expect(center[1]).toBeCloseTo(latitude, 8);
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 24; x++) {
        const point = gridPoint(r, x + 0.5, y + 0.5);
        expect(gridCell(r, ...point)).toEqual({ x, y });
      }
    expect(gridPoint(r, 0, 0)[1]).toBeGreaterThan(center[1]);
    expect(gridCell(r, ...gridPoint(r, -0.5, -0.5))).toEqual({ x: -1, y: -1 });
  });
  it('uses about 250 m cells at the center latitude', () => {
    const r = region(127, 37.5);
    const a = gridPoint(r, 12, 12),
      b = gridPoint(r, 13, 12);
    const meters = ((b[0] - a[0]) / 360) * 40_075_016.686 * Math.cos((37.5 * Math.PI) / 180);
    expect(meters).toBeCloseTo(250, 3);
  });
  it('formats hemisphere coordinates', () => {
    expect(coordinates([-9.1, 38.7])).toBe('38.70000° N, 9.10000° W');
  });
});
