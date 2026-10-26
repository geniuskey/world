import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';

export const placeName = (locale: string): ExpressionSpecification => [
  'coalesce',
  ['get', `name:${locale}`],
  ['get', 'name'],
  ['get', 'name:latin'],
];

// Keep names available at settlement scale, with a hierarchy as the user zooms in.
// Peak name with its elevation in metres underneath, when OpenStreetMap records one.
export const peakLabel = (locale: string): ExpressionSpecification => [
  'format',
  '▲ ',
  { 'text-color': '#8a6f4d' },
  placeName(locale),
  {},
  ['case', ['has', 'ele'], ['concat', '\n', ['to-string', ['get', 'ele']], ' m'], ''],
  { 'font-scale': 0.85 },
];

export const placeLabelLayers = [
  { id: 'country-names', classes: ['country'], minzoom: 0, maxzoom: 8, size: 13 },
  { id: 'province-names', classes: ['state', 'province'], minzoom: 5, size: 13 },
  { id: 'city-names', classes: ['city', 'town'], minzoom: 6, size: 14 },
  { id: 'district-names', classes: ['borough', 'suburb'], minzoom: 10, size: 13 },
  { id: 'village-names', classes: ['village', 'hamlet'], minzoom: 12, size: 12 },
  {
    id: 'neighbourhood-names',
    classes: ['quarter', 'neighbourhood', 'isolated_dwelling'],
    minzoom: 13,
    size: 12,
  },
];
// Terrarium-encoded elevation from the public AWS Terrain Tiles (Tilezen/Mapzen) for hillshading.
export const RELIEF_TILES =
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
export const RELIEF_ATTRIBUTION_URL =
  'https://github.com/tilezen/joerd/blob/master/docs/attribution.md';

// Muted OpenMapTiles land cover and land use, so forests, fields and towns read at a glance.
const landcoverColors: [string, string][] = [
  ['wood', '#c6d9ae'],
  ['grass', '#dbe6c2'],
  ['farmland', '#ebe8c6'],
  ['wetland', '#d0e2d2'],
  ['sand', '#efe5c6'],
  ['rock', '#d9d6cc'],
  ['ice', '#f3f6f6'],
];
const landuseColors: [string, string][] = [
  ['residential', '#e4dfd4'],
  ['suburb', '#e4dfd4'],
  ['neighbourhood', '#e4dfd4'],
  ['commercial', '#e2d9d0'],
  ['retail', '#e2d9d0'],
  ['industrial', '#dcd8d0'],
  ['quarry', '#d9d6cc'],
];
const classColor = (colors: [string, string][], fallback: string): ExpressionSpecification =>
  ['match', ['get', 'class'], ...colors.flat(), fallback] as unknown as ExpressionSpecification;

export function gameMapStyle(locale: string): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      land: {
        type: 'geojson',
        data: '/land.geojson',
        attribution: 'Natural Earth · Public domain',
      },
      basemap: {
        type: 'vector',
        url: import.meta.env.VITE_MAP_SOURCE_URL || 'https://tiles.openfreemap.org/planet',
        attribution: '© OpenMapTiles · © OpenStreetMap contributors',
      },
      relief: {
        type: 'raster-dem',
        tiles: [RELIEF_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Terrain Tiles · Mapzen, USGS, NASA SRTM and others',
      },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#b9d7d9' } },
      {
        id: 'land',
        type: 'fill',
        source: 'land',
        paint: { 'fill-color': '#e3ead6', 'fill-outline-color': '#a6b697' },
      },
      {
        id: 'landcover',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', landcoverColors.map(([name]) => name)]],
        paint: {
          'fill-color': classColor(landcoverColors, '#e3ead6'),
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 8, 0.85],
          'fill-antialias': false,
        },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landuse',
        minzoom: 8,
        filter: ['in', ['get', 'class'], ['literal', landuseColors.map(([name]) => name)]],
        paint: {
          'fill-color': classColor(landuseColors, '#e4dfd4'),
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 0.8],
        },
      },
      // Below the water fills, so seabed relief stays hidden under the ocean.
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'relief',
        paint: {
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 2, 0.2, 9, 0.4, 15, 0.3],
          'hillshade-shadow-color': '#5d6a55',
          'hillshade-highlight-color': '#fbfcf4',
          'hillshade-accent-color': '#7f8a70',
        },
      },
      {
        id: 'parks',
        type: 'line',
        source: 'basemap',
        'source-layer': 'park',
        minzoom: 7,
        paint: {
          'line-color': '#8faa79',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 14, 1.6],
          'line-opacity': 0.7,
          'line-dasharray': [2, 2],
        },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': '#b9d7d9' },
      },
      {
        id: 'rivers',
        type: 'line',
        source: 'basemap',
        'source-layer': 'waterway',
        minzoom: 6,
        filter: ['all', ['==', ['get', 'class'], 'river'], ['!=', ['get', 'brunnel'], 'tunnel']],
        paint: {
          'line-color': '#b9d7d9',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3],
        },
      },
      {
        id: 'countries',
        type: 'line',
        source: 'basemap',
        'source-layer': 'boundary',
        maxzoom: 9,
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: {
          'line-color': '#9fac92',
          'line-width': 0.8,
          'line-opacity': 0.6,
          'line-dasharray': [3, 3],
        },
      },
      ...[
        { id: 'province-boundaries', minzoom: 5, levels: [3, 4], color: '#8f9985', width: 1.2 },
        { id: 'district-boundaries', minzoom: 10, levels: [5, 6], color: '#a1a28f', width: 1 },
        {
          id: 'local-boundaries',
          minzoom: 13,
          levels: [7, 8, 9, 10],
          color: '#b0ac99',
          width: 0.8,
        },
      ].map(({ id, minzoom, levels, color, width }) => ({
        id,
        type: 'line' as const,
        source: 'basemap',
        'source-layer': 'boundary',
        minzoom,
        filter: [
          'all',
          ['in', ['get', 'admin_level'], ['literal', levels]],
          ['!=', ['get', 'maritime'], 1],
        ] as ExpressionSpecification,
        paint: {
          'line-color': color,
          'line-width': width,
          'line-opacity': 0.8,
          'line-dasharray': [4, 3],
        },
      })),
      {
        id: 'main-roads',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        minzoom: 10,
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary']]],
        paint: {
          'line-color': '#f9f7e9',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 16, 3],
        },
      },
      {
        id: 'highway-casing',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: {
          'line-color': '#c5a56b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 12, 3, 17, 7],
        },
      },
      {
        id: 'highways',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        minzoom: 6,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: {
          'line-color': '#f4dca1',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.8, 17, 5],
        },
      },
      {
        id: 'railways',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: ['==', ['get', 'class'], 'rail'],
        paint: {
          'line-color': '#7c8580',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 16, 2],
          'line-dasharray': [4, 2],
          'line-opacity': ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.4, 0.85],
        },
      },
      ...placeLabelLayers.map(({ id, classes, minzoom, size, ...range }) => ({
        id,
        type: 'symbol' as const,
        source: 'basemap',
        'source-layer': 'place',
        minzoom,
        ...range,
        filter: ['in', ['get', 'class'], ['literal', classes]] as ExpressionSpecification,
        layout: {
          'text-field': placeName(locale),
          'text-font': ['Noto Sans Regular'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            minzoom,
            size - 1,
            16,
            size + 2,
          ] as ExpressionSpecification,
          'text-padding': 12,
        },
        paint: { 'text-color': '#4f6250', 'text-halo-color': '#f1f3e6', 'text-halo-width': 1.8 },
      })),
      {
        id: 'water-names',
        type: 'symbol',
        source: 'basemap',
        'source-layer': 'water_name',
        minzoom: 3,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': placeName(locale),
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 12, 13],
          'text-letter-spacing': 0.1,
          'text-max-width': 6,
        },
        paint: { 'text-color': '#4f7f86', 'text-halo-color': '#cfe4e5', 'text-halo-width': 1.2 },
      },
      {
        id: 'peak-names',
        type: 'symbol',
        source: 'basemap',
        'source-layer': 'mountain_peak',
        minzoom: 8,
        filter: [
          'all',
          ['in', ['get', 'class'], ['literal', ['peak', 'volcano']]],
          ['has', 'name'],
          // Rank orders peaks within a tile by height and fame; minor hills would crowd towns.
          ['<=', ['get', 'rank'], 3],
        ],
        layout: {
          'text-field': peakLabel(locale),
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 13],
          'text-padding': 8,
          'symbol-sort-key': ['get', 'rank'],
        },
        paint: { 'text-color': '#5f5442', 'text-halo-color': '#f1f3e6', 'text-halo-width': 1.6 },
      },
    ],
  };
}
