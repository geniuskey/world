import type { Terrain } from './game';

// ESA WorldCover classes, one letter each. Game terrain follows the real cover: water cannot be
// owned, tree cover yields wood, farmland, grassland and wetland yield food, and built-up,
// bare, shrub and ice ground yield stone and iron. Mirrored by scripts/landcover.mjs.
export const LAND_COVER = {
  t: { code: 10, terrain: 'forest' },
  s: { code: 20, terrain: 'mountain' },
  g: { code: 30, terrain: 'meadow' },
  c: { code: 40, terrain: 'meadow' },
  u: { code: 50, terrain: 'mountain' },
  b: { code: 60, terrain: 'mountain' },
  i: { code: 70, terrain: 'mountain' },
  w: { code: 80, terrain: 'water' },
  e: { code: 90, terrain: 'meadow' },
  o: { code: 100, terrain: 'mountain' },
} as const satisfies Record<string, { code: number; terrain: Terrain }>;
export type LandCover = keyof typeof LAND_COVER;
export const isLandCover = (value: unknown): value is LandCover =>
  typeof value === 'string' && value in LAND_COVER;
export const LAND_COVER_SOURCE = {
  name: 'ESA WorldCover 2021 v200',
  url: 'https://esa-worldcover.org/en/data-access',
  license: 'CC BY 4.0',
  attribution:
    '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
};
