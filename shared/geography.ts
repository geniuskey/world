import type { Region } from './game';
import { worldTileFromId } from './worldGrid';

// Version 1 geographic grid: 250 m at the region's latitude, aligned in Web Mercator.
// This is a game location reference, not cadastral or surveyed land.
export const TILE_METERS = 250;
const EARTH_CIRCUMFERENCE = 40_075_016.686;
const mercatorY = (latitude: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / Math.PI) / 2;
const latitudeAt = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
function grid(region: Region) {
  const step = TILE_METERS / EARTH_CIRCUMFERENCE / Math.cos((region.latitude * Math.PI) / 180);
  return {
    step,
    west: (region.longitude + 180) / 360 - (region.width * step) / 2,
    north: mercatorY(region.latitude) - (region.height * step) / 2,
  };
}
export function gridPoint(region: Region, x: number, y: number): [number, number] {
  const { step, west, north } = grid(region);
  return [(west + x * step) * 360 - 180, latitudeAt(north + y * step)];
}
export function gridCell(region: Region, longitude: number, latitude: number) {
  const { step, west, north } = grid(region);
  return {
    x: Math.floor(((longitude + 180) / 360 - west) / step),
    y: Math.floor((mercatorY(latitude) - north) / step),
  };
}
export function coordinates([longitude, latitude]: [number, number]) {
  return `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(5)}° ${longitude < 0 ? 'W' : 'E'}`;
}
export const regionPlace = (id: string, locale: string) => {
  const tile = worldTileFromId(id);
  if (tile) return coordinates([(tile.west + tile.east) / 2, (tile.south + tile.north) / 2]);
  return id;
};
