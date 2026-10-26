import { useEffect, useState } from 'react';
import {
  chunkValue,
  placeCell,
  placeDatasetAt,
  placeFromIndex,
  type Place,
  type PlaceChunk,
  type PlaceIndex,
} from '../shared/places';

// Static, CDN-cached files: one index per country and one chunk per world tile.
const indexes = new Map<string, Promise<PlaceIndex>>();
const chunks = new Map<string, Promise<PlaceChunk>>();
const json = <T>(url: string) =>
  fetch(url).then((response) => {
    if (!response.ok) throw Error(`${url}: ${response.status}`);
    return response.json() as Promise<T>;
  });
const cached = <T>(cache: Map<string, Promise<T>>, url: string) => {
  if (!cache.has(url))
    cache.set(
      url,
      json<T>(url).catch((error) => {
        cache.delete(url);
        throw error;
      }),
    );
  return cache.get(url)!;
};

export type PlaceLookup = { place: Place; index: PlaceIndex };
export async function placeAt(longitude: number, latitude: number): Promise<PlaceLookup | null> {
  const dataset = placeDatasetAt(longitude, latitude);
  if (!dataset) return null;
  const index = await cached(indexes, `${dataset.path}/index.json`);
  const { root, row, column } = placeCell(longitude, latitude, index.cells);
  // Unlisted roots have no area; the SPA fallback would answer them with HTML.
  if (!index.roots.includes(root)) return null;
  const chunk = await cached(chunks, `${dataset.path}/${root.replace(':', '-')}.json`);
  const place = placeFromIndex(index, chunkValue(chunk, row, column));
  return place && { place, index };
}

export function usePlace(point: [number, number] | null | undefined) {
  const [lookup, setLookup] = useState<PlaceLookup | null>(null);
  const key = point ? `${point[0]},${point[1]}` : '';
  useEffect(() => {
    setLookup(null);
    if (!point) return;
    let current = true;
    placeAt(point[0], point[1])
      .then((result) => current && setLookup(result))
      .catch(() => current && setLookup(null));
    return () => {
      current = false;
    };
  }, [key]);
  return lookup;
}
