import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chunkValue,
  placeCell,
  placeDatasetAt,
  placeFromIndex,
  placeName,
  searchPlaces,
  type PlaceIndex,
} from '../shared/places';

const dir = 'public/places/kor';
const index: PlaceIndex = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
const at = (longitude: number, latitude: number) => {
  const { root, row, column } = placeCell(longitude, latitude, index.cells);
  if (!index.roots.includes(root)) return null;
  const chunk = JSON.parse(readFileSync(`${dir}/${root.replace(':', '-')}.json`, 'utf8'));
  return placeFromIndex(index, chunkValue(chunk, row, column));
};

describe('Korean administrative place lookup', () => {
  it('resolves known coordinates to their 2018 administrative areas', () => {
    expect(placeName(at(127.0276, 37.4979)!, 'ko')).toBe('서울특별시 강남구 역삼1동');
    expect(placeName(at(129.1604, 35.1587)!, 'ko')).toBe('부산광역시 해운대구 우1동');
    expect(placeName(at(126.4914, 33.5104)!, 'en')).toBe('Yongdam 2(i)-dong, Jeju-si, Jeju-do');
    expect(placeName(at(127.0561, 37.5446)!, 'ko', true)).toBe('성동구 성수2가3동');
  });
  it('returns nothing for sea and areas outside the dataset', () => {
    expect(at(128.5, 34.5)).toBeNull();
    expect(at(125.7625, 39.0392)).toBeNull();
    expect(placeDatasetAt(139.69, 35.68)).toBeUndefined();
  });
  it('keeps every area with a label point inside the area', () => {
    expect(index.areas).toHaveLength(3504);
    for (const [code, , , longitude, latitude] of index.areas)
      expect(at(longitude, latitude)?.code).toBe(code);
  });
  it('searches area names in both languages', () => {
    const names = searchPlaces(index, '성수').map((p) => placeName(p, 'ko', true));
    expect(names).toContain('성동구 성수2가3동');
    expect(searchPlaces(index, 'yeoksam 1').map((p) => p.code)).toHaveLength(1);
  });
});
