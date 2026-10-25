import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';

export const placeName = (locale: string): ExpressionSpecification => [
  'coalesce',
  ['get', `name:${locale}`],
  ['get', 'name:latin'],
  ['get', 'name'],
];

// Only geographic landmarks belong in the backdrop; game cells provide the detail.
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
      {
        id: 'country-names',
        type: 'symbol',
        source: 'basemap',
        'source-layer': 'place',
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          'text-field': placeName(locale),
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-padding': 20,
        },
        paint: { 'text-color': '#6d7f66', 'text-halo-color': '#e3ead6', 'text-halo-width': 1.5 },
      },
      {
        id: 'city-names',
        type: 'symbol',
        source: 'basemap',
        'source-layer': 'place',
        minzoom: 5,
        maxzoom: 12,
        filter: ['==', ['get', 'class'], 'city'],
        layout: {
          'text-field': placeName(locale),
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-padding': 35,
        },
        paint: { 'text-color': '#7d8b70', 'text-halo-color': '#e3ead6', 'text-halo-width': 1.5 },
      },
    ],
  };
}
