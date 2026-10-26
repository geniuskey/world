import type { Territory } from './game';
import { worldTileFromId } from './worldGrid';
import { isPlotRegion } from './plots';

export type MapActivity = {
  id: string;
  type: 'join' | 'claim' | 'build';
  created_at: number;
  actor_name: string;
  territory_id: string;
  region_id: string;
  x: number;
  y: number;
  longitude: number;
  latitude: number;
};
export type PopulationSample = {
  territory_id: string;
  population: number;
  year: number;
  source: string;
};
export type MapLayers = {
  resources: 'off' | 'all' | 'food' | 'wood' | 'iron';
  population: boolean;
  ownership: boolean;
  landmarks: boolean;
  activity: boolean;
};
export const defaultMapLayers: MapLayers = {
  resources: 'off',
  population: false,
  ownership: true,
  landmarks: false,
  activity: false,
};
export function readMapLayers(value: string | null): MapLayers {
  try {
    const input = JSON.parse(value ?? '{}');
    return {
      resources: ['off', 'all', 'food', 'wood', 'iron'].includes(input?.resources)
        ? input.resources
        : 'off',
      population: input?.population === true,
      ownership: input?.ownership !== false,
      landmarks: input?.landmarks === true,
      activity: input?.activity === true,
    };
  } catch {
    return { ...defaultMapLayers };
  }
}
export function readBookmarks(value: string | null): string[] {
  try {
    const input: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(input)
      ? [
          ...new Set(
            input.filter(
              (id): id is string =>
                typeof id === 'string' && (isPlotRegion(id) || !!worldTileFromId(id)),
            ),
          ),
        ].slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

// Runs in a Web Worker so even an unmatched worldwide query cannot block the map.
export type Landmark = { id: string; kind: 'peak' | 'lake' | 'grove' | 'ruins'; tile: Territory };
export function regionLandmarks(tiles: Territory[]): Landmark[] {
  return (
    [
      ['mountain', 'peak'],
      ['water', 'lake'],
      ['forest', 'grove'],
      ['meadow', 'ruins'],
    ] as const
  ).flatMap(([terrain, kind]) => {
    const candidates = tiles
      .filter((tile) => tile.terrain_type === terrain)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (!candidates.length) return [];
    const tile = candidates[Math.floor(candidates.length / 2)];
    return [{ id: `${tile.region_id}:${kind}`, kind, tile }];
  });
}

export function measureDistance(a: [number, number], b: [number, number]) {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLng = (b[0] - a[0]) * radians;
  const latA = a[1] * radians,
    latB = b[1] * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  const meters = 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  const bearing =
    (Math.atan2(
      Math.sin(dLng) * Math.cos(latB),
      Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(dLng),
    ) /
      radians +
      360) %
    360;
  return { meters, bearing };
}

// Sample the great circle, keeping longitudes continuous across the date line.
export function measurementPath(a: [number, number], b: [number, number]): [number, number][] {
  const { meters, bearing } = measureDistance(a, b);
  const r = Math.PI / 180;
  const distance = meters / 6371008.8;
  let previous = a[0];
  return Array.from({ length: 65 }, (_, index) => {
    const angle = (distance * index) / 64;
    const lat = Math.asin(
      Math.max(
        -1,
        Math.min(
          1,
          Math.sin(a[1] * r) * Math.cos(angle) +
            Math.cos(a[1] * r) * Math.sin(angle) * Math.cos(bearing * r),
        ),
      ),
    );
    const lng =
      a[0] +
      Math.atan2(
        Math.sin(bearing * r) * Math.sin(angle) * Math.cos(a[1] * r),
        Math.cos(angle) - Math.sin(a[1] * r) * Math.sin(lat),
      ) /
        r;
    const unwrapped = lng + Math.round((previous - lng) / 360) * 360;
    previous = unwrapped;
    return index === 64
      ? [b[0] + Math.round((previous - b[0]) / 360) * 360, b[1]]
      : [unwrapped, lat / r];
  });
}
