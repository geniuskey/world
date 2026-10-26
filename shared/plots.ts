import type { Region } from './game';
import { regionForTile, worldTileFromId } from './worldGrid';

// Land ownership v2 grid: every point on Earth lies in one Web Mercator zoom-17 tile
// (about 240 m at Korean latitudes). A settlement region is the zoom-14 tile holding
// an 8×8 block of plots. IDs come from coordinates, so nothing is pre-generated.
export const PLOT_ZOOM = 17;
export const REGION_ZOOM = 14;
export const REGION_PLOTS = 2 ** (PLOT_ZOOM - REGION_ZOOM);
const REGION_SIDE = 2 ** REGION_ZOOM;
const MAX_LATITUDE = 85.0511287798;

export const tileLongitude = (x: number, zoom: number) => (x / 2 ** zoom) * 360 - 180;
export const tileLatitude = (y: number, zoom: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** zoom))) * 180) / Math.PI;
const tileX = (longitude: number, zoom: number) =>
  (((((longitude + 180) % 360) + 360) % 360) / 360) * 2 ** zoom;
const tileY = (latitude: number, zoom: number) => {
  const sin = Math.sin((Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 2 ** zoom;
};

export function plotRegionFromId(id: string) {
  const match = /^z14:(\d{1,5}):(\d{1,5})$/.exec(id);
  if (!match) return null;
  const x = Number(match[1]),
    y = Number(match[2]);
  return x < REGION_SIDE && y < REGION_SIDE ? { x, y } : null;
}
export const isPlotRegion = (id: string) => plotRegionFromId(id) !== null;
export const plotRegionId = (x: number, y: number) => `z14:${x}:${y}`;

// Global plot coordinates and the region-local cell for a longitude/latitude.
export function plotAt(longitude: number, latitude: number) {
  const max = 2 ** PLOT_ZOOM - 1;
  const gx = Math.min(max, Math.floor(tileX(longitude, PLOT_ZOOM)));
  const gy = Math.min(max, Math.max(0, Math.floor(tileY(latitude, PLOT_ZOOM))));
  return {
    gx,
    gy,
    region: plotRegionId(Math.floor(gx / REGION_PLOTS), Math.floor(gy / REGION_PLOTS)),
    x: gx % REGION_PLOTS,
    y: gy % REGION_PLOTS,
  };
}
export const plotTerritoryId = (season: string, plot: ReturnType<typeof plotAt>) =>
  `${season}:${plot.region}:${plot.x}:${plot.y}`;

// Fractional plot coordinates inside a region, as used by gridPoint/gridCell.
export function plotPoint(region: { x: number; y: number }, x: number, y: number) {
  return [
    tileLongitude(region.x * REGION_PLOTS + x, PLOT_ZOOM),
    tileLatitude(region.y * REGION_PLOTS + y, PLOT_ZOOM),
  ] as [number, number];
}
export function plotCell(region: { x: number; y: number }, longitude: number, latitude: number) {
  // Unwrapped longitude keeps cells continuous for callers that shift across the date line.
  const x = ((longitude + 180) / 360) * 2 ** PLOT_ZOOM;
  return {
    x: Math.floor(x - region.x * REGION_PLOTS),
    y: Math.floor(tileY(latitude, PLOT_ZOOM) - region.y * REGION_PLOTS),
  };
}

export function plotRegionName(id: string, locale = 'en') {
  const region = plotRegionFromId(id);
  if (!region) return null;
  return `${locale === 'ko' ? '구역' : 'Block'} ${region.x}-${region.y}`;
}
export function plotRegion(id: string, season: string): Region | null {
  const region = plotRegionFromId(id);
  if (!region) return null;
  const [longitude, latitude] = plotPoint(region, REGION_PLOTS / 2, REGION_PLOTS / 2);
  return {
    id,
    season_id: season,
    name: plotRegionName(id)!,
    subtitle: `Zoom ${REGION_ZOOM}`,
    longitude,
    latitude,
    width: REGION_PLOTS,
    height: REGION_PLOTS,
    map_version: 1,
    world_split: 0,
    world_level: null,
    parent_id: null,
    owned: 0,
    available: REGION_PLOTS ** 2,
  };
}
// Any region a client can open: plot regions, or archived v1 world tiles.
export function regionFor(id: string, season: string): Region | null {
  const tile = worldTileFromId(id);
  return plotRegion(id, season) ?? (tile ? regionForTile(tile, season) : null);
}
export function parseTerritoryId(id: string) {
  const match = /^([^:]+):((?:earth2?|z14):[0-9:]+):(\d+):(\d+)$/.exec(id);
  return match ? { season: match[1], region: match[2], x: +match[3], y: +match[4] } : null;
}
