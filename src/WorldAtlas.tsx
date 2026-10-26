import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Map as EarthMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Focus, Globe2, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { useWorld } from './state';
import { api } from './api';
import { CHUNK_SIZE, type Region, type Territory } from '../shared/game';
import {
  worldTileAt,
  worldTileName,
  worldTileFromId,
  worldTilesForView,
  WORLD_INITIAL_TILES,
  type WorldTile,
} from '../shared/worldGrid';
import { coordinates, gridCell, gridPoint } from '../shared/geography';
import type { TextKey } from './i18n';
import { gameMapStyle, placeName, placeLabelLayers } from './mapStyle';
import { MapTools, useMapActivity } from './MapTools';
import { MapOverlays } from './MapOverlays';
import {
  measureDistance,
  readBookmarks,
  readMapLayers,
  type PopulationSample,
} from '../shared/mapFeatures';
import { terrainResource } from '../shared/game';

maplibregl.setWorkerUrl(workerUrl);

export function Atlas({
  region,
  onSelect,
  selected,
  focus,
}: {
  region?: Region;
  onSelect: (tile: Territory) => void;
  selected: string | null;
  focus: { x: number; y: number } | null;
}) {
  const { t, locale, state, user, revision, fail } = useWorld();
  const navigate = useNavigate();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<EarthMap | null>(null);
  const [layers, setLayers] = useState(() => {
    try {
      return readMapLayers(localStorage.getItem('world:map-layers'));
    } catch {
      return readMapLayers(null);
    }
  });
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      return readBookmarks(localStorage.getItem('world:bookmarks'));
    } catch {
      return [];
    }
  });
  const [storageError, setStorageError] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const activity = useMapActivity(region?.id, layers.activity || activityOpen, revision);
  const [population, setPopulation] = useState<PopulationSample[]>([]);
  const [populationError, setPopulationError] = useState(false);
  const [populationLoading, setPopulationLoading] = useState(false);
  const [populationRetry, setPopulationRetry] = useState(0);
  useEffect(() => {
    try {
      localStorage.setItem('world:map-layers', JSON.stringify(layers));
      localStorage.setItem('world:bookmarks', JSON.stringify(bookmarks));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [layers, bookmarks]);
  useEffect(() => {
    if (!region || !layers.population) return;
    const controller = new AbortController();
    setPopulationLoading(true);
    setPopulationError(false);
    void api<{ samples: PopulationSample[] }>(
      `/map/population?region=${encodeURIComponent(region.id)}`,
      { signal: controller.signal, fresh: true },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPopulation(result.samples);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPopulationError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPopulationLoading(false);
      });
    return () => controller.abort();
  }, [region?.id, layers.population, revision, populationRetry]);
  useEffect(() => {
    if (!measuring) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMeasuring(false);
        setMeasurePoints([]);
      }
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [measuring]);
  const [location, setLocation] = useState<{
    zone: WorldTile;
    point: [number, number];
    cell?: { x: number; y: number };
  } | null>(null);
  const gridId = useId().replace(/:/g, '');
  const gridGradient = useRef<SVGRadialGradientElement>(null);
  const gridSpotlight = useRef<SVGRectElement>(null);
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [retry, setRetry] = useState(0);
  const [globe, setGlobe] = useState(false);
  const flatCamera = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const changeProjection = (nextGlobe: boolean) => {
    const map = mapRef.current;
    if (!map || nextGlobe === globe) return;
    if (nextGlobe) {
      flatCamera.current = { center: map.getCenter().toArray(), zoom: map.getZoom() };
      const size = map.getContainer();
      const fittedGlobe = Math.log2(Math.min(size.clientWidth, size.clientHeight) / 512) + 0.8;
      map.jumpTo({ zoom: Math.min(map.getZoom(), fittedGlobe) });
    } else if (flatCamera.current) map.jumpTo(flatCamera.current);
    setGlobe(nextGlobe);
  };
  const [basemapError, setBasemapError] = useState(false);
  const [zones, setZones] = useState<WorldTile[]>([]);
  const [zonesError, setZonesError] = useState(false);
  const [zoneBounds, setZoneBounds] = useState('-180,-90,180,90');
  const [zoneTotal, setZoneTotal] = useState(WORLD_INITIAL_TILES);
  const zoneRef = useRef(zones);
  zoneRef.current = zones;
  const [tiles, setTiles] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [view, setView] = useState({ width: 700, height: 526, zoom: 0, lng: 0, lat: 0, frame: 0 });
  const current = useRef({ region, tiles, onSelect, measuring });
  current.current = { region, tiles, onSelect, measuring };
  const focusLandmark = useCallback(
    (tile: Territory) => {
      if (!region) return;
      const point = gridPoint(region, tile.x + 0.5, tile.y + 0.5);
      mapRef.current?.jumpTo({ center: point, zoom: 15 });
      onSelect(tile);
      const zone = worldTileFromId(region.id);
      if (zone) setLocation({ zone, point, cell: tile });
    },
    [region, onSelect],
  );
  const home = state?.territories.find((tile) => tile.region_id === region?.id);
  const reset = () => {
    const map = mapRef.current;
    if (!map) return;
    map.jumpTo({
      center: region
        ? gridPoint(
            region,
            (home?.x ?? region.width / 2) + 0.5,
            (home?.y ?? region.height / 2) + 0.5,
          )
        : [20, 20],
      zoom: region ? 14 : Math.log2((container.current?.clientWidth || 700) / 512) - 0.1,
      bearing: 0,
      pitch: 0,
    });
  };
  useEffect(() => {
    if (!container.current) return;
    setReady(false);
    setUnsupported(false);
    setBasemapError(false);
    let map: EarthMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        center: region
          ? gridPoint(
              region,
              (home?.x ?? region.width / 2) + 0.5,
              (home?.y ?? region.height / 2) + 0.5,
            )
          : [20, 20],
        zoom: region ? 14 : Math.log2((container.current?.clientWidth || 700) / 512) - 0.1,
        minZoom: -2,
        maxZoom: 19,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        attributionControl: false,
        style: gameMapStyle(locale),
      });
    } catch {
      setUnsupported(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    const canvas = map.getCanvas();
    // Update only the mask, avoiding a React render for every pointer movement.
    const revealGrid = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      gridGradient.current?.setAttribute('cx', String(event.clientX - bounds.left));
      gridGradient.current?.setAttribute('cy', String(event.clientY - bounds.top));
      gridSpotlight.current?.setAttribute('opacity', '1');
    };
    const hideGrid = () => gridSpotlight.current?.setAttribute('opacity', '0');
    const releaseGrid = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') hideGrid();
    };
    canvas.addEventListener('pointermove', revealGrid);
    canvas.addEventListener('pointerdown', revealGrid);
    canvas.addEventListener('pointerleave', hideGrid);
    canvas.addEventListener('pointerup', releaseGrid);
    canvas.addEventListener('pointercancel', hideGrid);
    const update = () => {
      const center = map.getCenter();
      setView((v) => ({
        width: map.getContainer().clientWidth,
        height: map.getContainer().clientHeight,
        zoom: map.getZoom(),
        lng: center.lng,
        lat: center.lat,
        frame: v.frame + 1,
      }));
    };
    const updateBounds = () => {
      const bounds = map.getBounds();
      const width = Math.min(360, bounds.getEast() - bounds.getWest());
      const west = width >= 360 ? -180 : ((((bounds.getWest() + 180) % 360) + 360) % 360) - 180;
      setZoneBounds(
        [west, Math.max(-90, bounds.getSouth()), west + width, Math.min(90, bounds.getNorth())]
          .map((n) => n.toFixed(5))
          .join(','),
      );
    };
    map.on('render', update);
    map.on('moveend', updateBounds);
    map.on('resize', update);
    map.on('style.load', () => {
      setReady(true);
      update();
      updateBounds();
    });
    map.on('error', () => {
      setBasemapError(true);
    });
    map.on('sourcedata', (event) => {
      if (event.sourceId === 'basemap' && event.sourceDataType === 'content')
        setBasemapError(false);
    });
    map.on('click', (event) => {
      const { region: active, tiles: visible, onSelect: select } = current.current;
      const { lng, lat } = event.lngLat;
      if (current.current.measuring) {
        setLocation(null);
        setMeasurePoints((points) => (points.length >= 2 ? [[lng, lat]] : [...points, [lng, lat]]));
        return;
      }
      const zone = worldTileAt(lng, lat, zoneRef.current);
      if (!active || map.getZoom() < 9) {
        if (zone.id === active?.id) setLocation({ zone, point: [lng, lat] });
        else navigate(`/region/${zone.id}`);
        return;
      }
      const longitude = lng + Math.round((active.longitude - lng) / 360) * 360;
      const cell = gridCell(active, longitude, lat);
      const tile = visible.find((tile) => tile.x === cell.x && tile.y === cell.y);
      if (tile) {
        select(tile);
        setLocation({ zone: worldTileFromId(active.id) ?? zone, point: [lng, lat], cell });
      } else if (zone.id !== active.id) navigate(`/region/${zone.id}`);
      else setLocation({ zone, point: [lng, lat] });
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointermove', revealGrid);
      canvas.removeEventListener('pointerdown', revealGrid);
      canvas.removeEventListener('pointerleave', hideGrid);
      canvas.removeEventListener('pointerup', releaseGrid);
      canvas.removeEventListener('pointercancel', hideGrid);
      hideGrid();
      mapRef.current = null;
      map.remove();
    };
  }, [region?.id, retry]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !location) return;
    const title = document.createElement('strong');
    title.textContent = `${worldTileName(location.zone, locale)}${location.cell ? ` · ${location.cell.x + 1}-${location.cell.y + 1}` : ''}`;
    const point = document.createElement('div');
    point.textContent = coordinates(location.point);
    const content = document.createElement('div');
    content.setAttribute('role', 'status');
    content.appendChild(title);
    content.appendChild(point);
    const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
      .setLngLat(location.point)
      .setDOMContent(content)
      .addTo(map);
    return () => {
      popup.remove();
    };
  }, [ready, location, locale]);
  useEffect(() => {
    const controller = new AbortController();
    setZonesError(false);
    const timer = setTimeout(() => {
      void api<{ tiles: WorldTile[]; total_tiles: number; stride: number }>(
        `/world/tiles?bbox=${zoneBounds}`,
        {
          signal: controller.signal,
          fresh: revision > 0,
        },
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setZones(result.tiles);
          setZoneTotal(result.total_tiles);
        })
        .catch(() => {
          if (!controller.signal.aborted) setZonesError(true);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [zoneBounds, revision, retry]);
  useEffect(() => {
    if (!ready) return;
    for (const { id } of placeLabelLayers)
      mapRef.current?.setLayoutProperty(id, 'text-field', placeName(locale));
  }, [ready, locale]);
  useEffect(() => {
    if (ready) mapRef.current?.setProjection({ type: globe ? 'globe' : 'mercator' });
  }, [globe, ready]);
  useEffect(() => {
    if (!ready || !region || !focus) return;
    mapRef.current?.jumpTo({ center: gridPoint(region, focus.x + 0.5, focus.y + 0.5), zoom: 14 });
  }, [ready, focus, region?.id]);
  useEffect(() => {
    if (!region) return;
    const controller = new AbortController();
    setLoading(true);
    setTileError(false);
    const timer = setTimeout(() => {
      const requests: Promise<Territory[]>[] = [];
      for (let cy = 0; cy < Math.ceil(region.height / CHUNK_SIZE); cy++)
        for (let cx = 0; cx < Math.ceil(region.width / CHUNK_SIZE); cx++)
          requests.push(
            api<{ tiles: Territory[] }>(`/map/chunks?region=${region.id}&cx=${cx}&cy=${cy}`, {
              signal: controller.signal,
              fresh: revision > 0,
            }).then((result) => result.tiles),
          );
      void Promise.all(requests)
        .then((chunks) => {
          if (!controller.signal.aborted) setTiles(chunks.flat());
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setTileError(true);
            fail(error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [region?.id, revision, retry]);
  const map = mapRef.current;
  const bounds = ready && map ? map.getBounds() : null;
  const worldGrid =
    bounds && (!region || view.zoom < 9)
      ? worldTilesForView(
          {
            west: bounds.getWest(),
            east: bounds.getEast(),
            south: Math.max(-90, bounds.getSouth()),
            north: Math.min(90, bounds.getNorth()),
          },
          zones,
        )
      : { tiles: [], stride: 1 };
  // Repeat the regional grid over the viewport, including outside the 8×8
  // settlement. Territory polygons still carry the actual game state.
  const gridOrigin =
    ready && map && region && view.zoom >= 9 ? map.project(gridPoint(region, 0, 0)) : null;
  const gridNext = gridOrigin && map && region ? map.project(gridPoint(region, 1, 1)) : null;
  const cellWidth = gridOrigin && gridNext ? Math.abs(gridNext.x - gridOrigin.x) : 0;
  const cellHeight = gridOrigin && gridNext ? Math.abs(gridNext.y - gridOrigin.y) : 0;
  // Group lines when zoomed out so the pattern stays legible and bounded.
  const gridStride = cellWidth > 0 ? 2 ** Math.max(0, Math.ceil(Math.log2(12 / cellWidth))) : 1;
  const gridWidth = cellWidth * gridStride;
  const gridHeight = cellHeight * gridStride;
  const showRegionalGrid =
    gridOrigin &&
    Number.isFinite(gridWidth) &&
    Number.isFinite(gridHeight) &&
    gridWidth > 0 &&
    gridHeight > 0;
  return (
    <div
      className={`atlas earth-atlas ${region ? 'regional' : 'global'} ${measuring ? 'is-measuring' : ''}`}
      data-map-ready={ready}
      data-visible-world-tiles={worldGrid.tiles.length}
    >
      <div ref={container} className="earth-map" />
      <MapTools
        region={region}
        tiles={tiles}
        layers={layers}
        setLayers={setLayers}
        bookmarks={bookmarks}
        setBookmarks={setBookmarks}
        storageError={storageError}
        measuring={measuring}
        setMeasuring={(value) => {
          setMeasuring(value);
          if (!value) setMeasurePoints([]);
        }}
        points={measurePoints}
        clearPoints={() => setMeasurePoints([])}
        onFocus={focusLandmark}
        activities={activity.activities}
        activityError={activity.error}
        activityLoading={activity.loading}
        retryActivity={activity.retry}
        onActivityOpen={setActivityOpen}
        population={population}
        populationError={populationError}
        populationLoading={populationLoading}
        retryPopulation={() => setPopulationRetry((value) => value + 1)}
      />
      <MapOverlays
        map={map}
        ready={ready}
        region={region}
        tiles={tiles}
        layers={layers}
        bookmarks={bookmarks}
        population={population}
        activities={activity.activities}
        points={measurePoints}
        onFocus={focusLandmark}
        measuring={measuring}
      />
      <svg
        className="earth-cells"
        role="img"
        aria-label={t(region ? 'regionalMap' : 'worldMap')}
        viewBox={`0 0 ${view.width} ${view.height}`}
        data-camera={`${view.lng},${view.lat}`}
        data-zoom={view.zoom}
      >
        <defs>
          <radialGradient
            ref={gridGradient}
            id={`${gridId}-gradient`}
            gradientUnits="userSpaceOnUse"
            cx="0"
            cy="0"
            r="160"
          >
            <stop offset="0" stopColor="white" />
            <stop offset="0.4" stopColor="white" />
            <stop offset="1" stopColor="black" />
          </radialGradient>
          <mask
            id={`${gridId}-mask`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={view.width}
            height={view.height}
          >
            <rect
              ref={gridSpotlight}
              width={view.width}
              height={view.height}
              fill={`url(#${gridId}-gradient)`}
              opacity="0"
            />
          </mask>
          {showRegionalGrid && (
            <pattern
              id={`${gridId}-regional-pattern`}
              patternUnits="userSpaceOnUse"
              x={gridOrigin.x % gridWidth}
              y={gridOrigin.y % gridHeight}
              width={gridWidth}
              height={gridHeight}
            >
              <path
                d={`M ${gridWidth} 0 H 0 V ${gridHeight}`}
                fill="none"
                stroke="#536c50"
                strokeWidth={1.2}
                strokeOpacity={0.8}
              />
            </pattern>
          )}
        </defs>
        {showRegionalGrid && (
          <rect
            className="regional-grid"
            aria-hidden="true"
            width={view.width}
            height={view.height}
            fill={`url(#${gridId}-regional-pattern)`}
            mask={`url(#${gridId}-mask)`}
          />
        )}
        {ready && map && (!region || view.zoom < 9) && (
          <g mask={`url(#${gridId}-mask)`} className="world-grid" aria-hidden="true">
            {worldGrid.tiles.map((zone) => {
              const shift = globe
                ? 0
                : Math.round((view.lng - (zone.west + zone.east) / 2) / 360) * 360;
              const locations: [number, number][] = [
                [zone.west + shift, zone.south],
                [zone.east + shift, zone.south],
                [zone.east + shift, zone.north],
                [zone.west + shift, zone.north],
              ];
              const points = locations.map((point) => map.project(point));
              // Back-facing globe points project onto the visible hemisphere; inverse
              // projection identifies them without relying on MapLibre internals.
              if (
                globe &&
                points.some((point, index) => {
                  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return true;
                  try {
                    const visible = map.unproject(point);
                    const [lng, lat] = locations[index];
                    const delta = ((visible.lng - lng + 540) % 360) - 180;
                    return Math.abs(delta) > 0.1 || Math.abs(visible.lat - lat) > 0.1;
                  } catch {
                    // During a projection transition, a point may be outside the globe.
                    return true;
                  }
                })
              )
                return null;
              return (
                <polygon
                  key={zone.id}
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="#b8d4ac"
                  fillOpacity={0.1}
                  stroke="#315e49"
                  strokeWidth={1}
                  strokeOpacity={0.7}
                />
              );
            })}
          </g>
        )}
        {ready &&
          map &&
          region &&
          view.zoom >= 9 &&
          tiles.map((tile) => {
            const corners = [
              [tile.x, tile.y],
              [tile.x + 1, tile.y],
              [tile.x + 1, tile.y + 1],
              [tile.x, tile.y + 1],
            ].map(([x, y]) => map.project(gridPoint(region, x, y)));
            if (
              corners.every((p) => p.x < 0) ||
              corners.every((p) => p.x > view.width) ||
              corners.every((p) => p.y < 0) ||
              corners.every((p) => p.y > view.height)
            )
              return null;
            const mine = Boolean(user && tile.owner_user_id === user.id);
            const occupied = Boolean(tile.owner_user_id);
            const active = selected === tile.id;
            const resource =
              tile.terrain_type === 'water' ? null : terrainResource[tile.terrain_type];
            const showResource =
              layers.resources !== 'off' &&
              resource &&
              (layers.resources === 'all' || layers.resources === resource);
            const fill = showResource
              ? ({ food: '#8daf4d', wood: '#277c70', iron: '#bf8b46' } as const)[resource]
              : layers.population && !population.some((sample) => sample.territory_id === tile.id)
                ? '#9b9fa0'
                : mine && layers.ownership
                  ? '#397952'
                  : occupied && layers.ownership
                    ? '#b57c40'
                    : tile.terrain_type === 'water'
                      ? '#7dbcd7'
                      : '#c6d8ab';
            return (
              <polygon
                key={tile.id}
                points={corners.map((p) => `${p.x},${p.y}`).join(' ')}
                data-testid={`tile-${tile.x}-${tile.y}`}
                role="button"
                tabIndex={0}
                aria-label={`${t(tile.terrain_type)} ${tile.x}, ${tile.y}${mine ? ' ' + t('yours') : occupied ? ' ' + t('neighbors') : ''}`}
                fill={fill}
                mask={
                  active ||
                  (occupied && layers.ownership) ||
                  layers.resources !== 'off' ||
                  layers.population
                    ? undefined
                    : `url(#${gridId}-mask)`
                }
                fillOpacity={
                  active
                    ? 0.4
                    : showResource
                      ? tile.structure_type
                        ? 0.65
                        : 0.35
                      : layers.resources !== 'off'
                        ? 0.05
                        : occupied && layers.ownership
                          ? 0.3
                          : 0.1
                }
                stroke={active ? '#123b2a' : mine && layers.ownership ? '#295839' : '#97602d'}
                strokeWidth={active ? 3 : occupied && layers.ownership ? 2 : 0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(tile);
                  }
                }}
              />
            );
          })}
      </svg>
      {measuring && (
        <div className="map-measure-banner" role="status">
          {measurePoints.length < 2
            ? t(measurePoints.length ? 'mapMeasureSecond' : 'mapMeasureFirst')
            : `${t('mapDistance')}: ${(measureDistance(measurePoints[0], measurePoints[1]).meters / 1000).toFixed(2)} km · ${measureDistance(measurePoints[0], measurePoints[1]).bearing.toFixed(1)}°`}
          <button
            aria-label={t('mapStopMeasure')}
            onClick={() => {
              setMeasuring(false);
              setMeasurePoints([]);
            }}
          >
            ×
          </button>
        </div>
      )}
      {region && layers.resources !== 'off' && (
        <div className="map-resource-key" aria-label={t('mapResources')}>
          {(['food', 'wood', 'iron'] as const)
            .filter((kind) => layers.resources === 'all' || layers.resources === kind)
            .map((kind) => (
              <span key={kind}>
                <i className={`resource-swatch ${kind}`} />
                {t(kind)}
              </span>
            ))}
        </div>
      )}
      <div className="atlas-label">
        <span className="status-dot" />
        {region
          ? t(region.id as TextKey)
          : t('worldTileCount', {
              count: zoneTotal.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
            })}
      </div>
      <div className="earth-projection" role="group" aria-label={t('mapView')}>
        <button aria-pressed={!globe} onClick={() => changeProjection(false)}>
          <MapIcon size={14} />
          {t('flatMap')}
        </button>
        <button aria-pressed={globe} onClick={() => changeProjection(true)}>
          <Globe2 size={14} />
          {t('globeMap')}
        </button>
      </div>
      {unsupported ? (
        <div className="earth-error" role="status">
          <p>{t('webglUnavailable')}</p>
          <button className="button small" onClick={() => setRetry((v) => v + 1)}>
            {t('retry')}
          </button>
        </div>
      ) : (
        (loading || tileError || zonesError || basemapError || !ready) && (
          <div className="map-loading" role="status">
            {tileError || zonesError || basemapError ? t('mapUnavailable') : t('loadingMap')}
            {(tileError || zonesError || basemapError) && (
              <button onClick={() => setRetry((v) => v + 1)}>{t('retry')}</button>
            )}
          </div>
        )
      )}
      <div className="map-controls">
        <button className="icon-button" aria-label={t('zoomIn')} onClick={() => map?.zoomIn()}>
          <Plus size={20} />
        </button>
        <button className="icon-button" aria-label={t('zoomOut')} onClick={() => map?.zoomOut()}>
          <Minus size={20} />
        </button>
        <span />
        <button className="icon-button" aria-label={t('resetView')} onClick={reset}>
          <Focus size={19} />
        </button>
      </div>
      {region && (
        <div className="map-legend">
          <span>
            <i className="legend-dot mine" />
            {t('yours')}
          </span>
          <span>
            <i className="legend-dot other" />
            {t('neighbors')}
          </span>
          <span>
            <i className="legend-dot empty" />
            {t('open')}
          </span>
        </div>
      )}
      <div className="earth-map-hint">
        {region
          ? t(view.zoom < 9 ? 'zoomForTiles' : 'geographicOverlay')
          : t(worldGrid.stride > 1 ? 'worldOverviewHint' : 'worldExploreHint')}
      </div>
      <div className="earth-attribution">
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
          OpenFreeMap
        </a>
        {' · Natural Earth · '}
        <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">
          OpenMapTiles
        </a>
        {' · '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </div>
      <div className="earth-center">{coordinates([view.lng, view.lat])}</div>
    </div>
  );
}
