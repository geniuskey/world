import { useEffect } from 'react';
import { GeoJSONSource, Marker, type Map as EarthMap } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import { useNavigate } from 'react-router-dom';
import { useWorld } from './state';
import { gridPoint } from '../shared/geography';
import type { Region, Territory } from '../shared/game';
import { regionFor } from '../shared/plots';
import type { TextKey } from './i18n';
import {
  measurementPath,
  regionLandmarks,
  type MapLayers,
  type MapActivity,
  type PopulationSample,
} from '../shared/mapFeatures';
import { activityKeys, landmarkIcons, landmarkKeys } from './MapTools';

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
function setSource(map: EarthMap, id: string, data: FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

export function MapOverlays({
  map,
  ready,
  region,
  tiles,
  layers,
  bookmarks,
  population,
  activities,
  points,
  onFocus,
  measuring,
}: {
  map: EarthMap | null;
  ready: boolean;
  region?: Region;
  tiles: Territory[];
  layers: MapLayers;
  bookmarks: string[];
  population: PopulationSample[];
  activities: MapActivity[];
  points: [number, number][];
  onFocus: (tile: Territory) => void;
  measuring: boolean;
}) {
  const { t, locale } = useWorld();
  const navigate = useNavigate();
  useEffect(() => {
    if (!ready || !map) return;
    const byId = new Map(population.map((sample) => [sample.territory_id, sample]));
    const max = Math.max(1, ...population.map((sample) => sample.population));
    const data: FeatureCollection =
      region && layers.population
        ? {
            type: 'FeatureCollection',
            features: tiles.flatMap((tile) => {
              const sample = byId.get(tile.id);
              return sample && sample.population > 0
                ? [
                    {
                      type: 'Feature' as const,
                      properties: { weight: sample.population / max },
                      geometry: {
                        type: 'Point' as const,
                        coordinates: gridPoint(region, tile.x + 0.5, tile.y + 0.5),
                      },
                    },
                  ]
                : [];
            }),
          }
        : empty;
    setSource(map, 'game-population', data);
    if (!map.getLayer('game-population-heat'))
      map.addLayer(
        {
          id: 'game-population-heat',
          type: 'heatmap',
          source: 'game-population',
          minzoom: 9,
          paint: {
            'heatmap-weight': ['get', 'weight'],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 14, 30, 19, 80],
            'heatmap-intensity': 1.6,
            'heatmap-opacity': 0.8,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(66,133,180,0)',
              0.2,
              '#72b7c5',
              0.45,
              '#d8e884',
              0.7,
              '#ecb34e',
              1,
              '#c44732',
            ],
          },
        },
        'country-names',
      );
  }, [map, ready, region, tiles, layers.population, population]);
  useEffect(() => {
    if (!ready || !map) return;
    const features: FeatureCollection<Geometry>['features'] = points.map((point, index) => ({
      type: 'Feature',
      properties: { index },
      geometry: { type: 'Point', coordinates: point },
    }));
    if (points.length === 2)
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: measurementPath(points[0], points[1]) },
      });
    setSource(map, 'game-measurement', { type: 'FeatureCollection', features });
    if (!map.getLayer('game-measure-line')) {
      map.addLayer({
        id: 'game-measure-line',
        type: 'line',
        source: 'game-measurement',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#8556ad', 'line-width': 3, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: 'game-measure-points',
        type: 'circle',
        source: 'game-measurement',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#8556ad',
          'circle-radius': 6,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
    }
  }, [map, ready, points]);
  useEffect(() => {
    if (!ready || !map) return;
    const markers: Marker[] = [];
    const addMarker = (
      point: [number, number],
      label: string,
      symbol: string,
      kind: string,
      click: () => void,
    ) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `game-map-marker ${kind}`;
      button.textContent = symbol;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!measuring) click();
      });
      button.disabled = measuring;
      markers.push(new Marker({ element: button }).setLngLat(point).addTo(map));
    };
    for (const id of bookmarks) {
      const saved = regionFor(id, '');
      if (saved)
        addMarker(
          [saved.longitude, saved.latitude],
          `${t('mapBookmarks')}: ${t(id as TextKey)}`,
          '★',
          'bookmark-marker',
          () => navigate(`/region/${id}`),
        );
    }
    if (layers.landmarks && region)
      for (const landmark of regionLandmarks(tiles)) {
        addMarker(
          gridPoint(region, landmark.tile.x + 0.5, landmark.tile.y + 0.5),
          `${t(landmarkKeys[landmark.kind])} · ${landmark.tile.x + 1}-${landmark.tile.y + 1}`,
          landmarkIcons[landmark.kind],
          'landmark-marker',
          () => onFocus(landmark.tile),
        );
      }
    if (layers.activity) {
      const seen = new Set<string>();
      for (const activity of activities) {
        if (seen.has(activity.territory_id)) continue;
        seen.add(activity.territory_id);
        const target = regionFor(activity.region_id, '');
        if (!target) continue;
        addMarker(
          gridPoint(target, activity.x + 0.5, activity.y + 0.5),
          `${t(activityKeys[activity.type])} · ${activity.actor_name}`,
          activity.type === 'build' ? '⌂' : '+',
          'activity-marker',
          () => navigate(`/territory/${activity.territory_id}`),
        );
      }
    }
    return () => {
      markers.forEach((marker) => marker.remove());
    };
  }, [
    map,
    ready,
    region,
    tiles,
    bookmarks,
    layers.landmarks,
    layers.activity,
    activities,
    locale,
    t,
    onFocus,
    navigate,
    measuring,
  ]);
  return null;
}
