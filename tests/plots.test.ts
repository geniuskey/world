import { describe, expect, it } from 'vitest';
import { gridCell, gridPoint } from '../shared/geography';
import {
  parseTerritoryId,
  plotAt,
  plotRegion,
  plotRegionFromId,
  plotTerritoryId,
  REGION_PLOTS,
  tileLatitude,
  tileLongitude,
} from '../shared/plots';

describe('global zoom-17 plot grid', () => {
  it('matches the standard Web Mercator tile for a coordinate', () => {
    // Seoul City Hall lies in OpenStreetMap tile 17/111767/50758.
    const plot = plotAt(126.9779, 37.5663);
    expect([plot.gx, plot.gy]).toEqual([111767, 50758]);
    expect(plot.region).toBe('z14:13970:6344');
    expect([plot.x, plot.y]).toEqual([7, 6]);
    expect(tileLongitude(plot.gx, 17)).toBeLessThanOrEqual(126.9779);
    expect(tileLongitude(plot.gx + 1, 17)).toBeGreaterThan(126.9779);
    expect(tileLatitude(plot.gy, 17)).toBeGreaterThan(37.5663);
    expect(tileLatitude(plot.gy + 1, 17)).toBeLessThanOrEqual(37.5663);
  });
  it('round-trips plots through region-local grid points and cells', () => {
    for (const [longitude, latitude] of [
      [127.0276, 37.4979],
      [-0.1276, 51.5072],
      [-58.38, -34.6],
      [179.999, 0.001],
      [-179.999, -0.001],
    ]) {
      const plot = plotAt(longitude, latitude);
      const region = plotRegion(plot.region, 's1')!;
      expect(gridCell(region, longitude, latitude)).toEqual({ x: plot.x, y: plot.y });
      const [west, north] = gridPoint(region, plot.x, plot.y);
      const [east, south] = gridPoint(region, plot.x + 1, plot.y + 1);
      expect(longitude).toBeGreaterThanOrEqual(west);
      expect(longitude).toBeLessThan(east);
      expect(latitude).toBeLessThan(north);
      expect(latitude).toBeGreaterThanOrEqual(south);
      expect(region.width).toBe(REGION_PLOTS);
    }
  });
  it('wraps longitude, clamps the poles and validates identifiers', () => {
    expect(plotAt(181, 10)).toEqual(plotAt(-179, 10));
    expect(plotAt(0, 89.9).gy).toBe(0);
    expect(plotAt(0, -89.9).gy).toBe(2 ** 17 - 1);
    expect(plotRegionFromId('z14:16383:16383')).toEqual({ x: 16383, y: 16383 });
    expect(plotRegionFromId('z14:16384:0')).toBeNull();
    expect(plotRegionFromId('earth2:873:725')).toBeNull();
    const id = plotTerritoryId('s1', plotAt(126.9779, 37.5663));
    expect(parseTerritoryId(id)).toEqual({ season: 's1', region: 'z14:13970:6344', x: 7, y: 6 });
    expect(parseTerritoryId('s1:earth2:873:725:3:4')?.region).toBe('earth2:873:725');
  });
});
