import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';

export const placeName = (locale: string): ExpressionSpecification => [
  'coalesce',
  ['get', `name:${locale}`],
  ['get', 'name'],
  ['get', 'name:latin'],
];

// Keep names available at settlement scale, with a hierarchy as the user zooms in.
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
    ],
  };
}
