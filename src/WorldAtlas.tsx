import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Map as EarthMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Focus, Globe2, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { useWorld } from './state';
import { api } from './api';
import { CHUNK_SIZE, type Region, type Territory } from '../shared/game';
import { rootTileAt, WORLD_INITIAL_TILES, type WorldTile } from '../shared/worldGrid';
import { coordinates, gridCell, gridPoint } from '../shared/geography';
import type { TextKey } from './i18n';
import { gameMapStyle, placeName } from './mapStyle';

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
  const [zoneStride, setZoneStride] = useState(32);
  const zoneRef = useRef(zones);
  zoneRef.current = zones;
  const [tiles, setTiles] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [view, setView] = useState({ width: 700, height: 526, zoom: 0, lng: 0, lat: 0, frame: 0 });
  const current = useRef({ region, tiles, onSelect });
  current.current = { region, tiles, onSelect };
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
      zoom: region ? 13 : Math.log2((container.current?.clientWidth || 700) / 512) - 0.1,
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
        zoom: region ? 13 : Math.log2((container.current?.clientWidth || 700) / 512) - 0.1,
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
    map.on('move', update);
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
      if (!active || map.getZoom() < 9) {
        const { lng, lat } = event.lngLat;
        const longitude = ((((lng + 180) % 360) + 360) % 360) - 180;
        const zone = zoneRef.current.find(
          (z) =>
            z.level >= 0 &&
            longitude >= z.west &&
            longitude < z.east &&
            lat >= z.south &&
            lat < z.north,
        );
        navigate(`/region/${zone?.id ?? rootTileAt(lng, lat).id}`);
        return;
      }
      const cell = gridCell(active, event.lngLat.lng, event.lngLat.lat);
      const tile = visible.find((tile) => tile.x === cell.x && tile.y === cell.y);
      if (tile) select(tile);
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      mapRef.current = null;
      map.remove();
    };
  }, [region?.id, retry]);
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
          setZoneStride(result.stride);
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
    const map = mapRef.current;
    if (!ready || !map) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: zones.map((z) => ({
        type: 'Feature' as const,
        properties: { id: z.id, population: z.population, level: z.level },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [z.west, z.south],
              [z.east, z.south],
              [z.east, z.north],
              [z.west, z.north],
              [z.west, z.south],
            ],
          ],
        },
      })),
    };
    const source = map.getSource('world-zones') as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource('world-zones', { type: 'geojson', data });
      map.addLayer({
        id: 'world-zone-fill',
        type: 'fill',
        source: 'world-zones',
        maxzoom: region ? 9 : 24,
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'population'],
            0,
            '#b8d4ac',
            8,
            '#3b7953',
          ],
          'fill-opacity': 0.16,
        },
      });
      map.addLayer({
        id: 'world-zone-lines',
        type: 'line',
        source: 'world-zones',
        maxzoom: region ? 9 : 24,
        paint: { 'line-color': '#315e49', 'line-width': 1, 'line-opacity': 0.8 },
      });
    }
  }, [ready, zones, region?.id]);
  useEffect(() => {
    if (!ready) return;
    for (const layer of ['country-names', 'city-names'])
      mapRef.current?.setLayoutProperty(layer, 'text-field', placeName(locale));
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
  return (
    <div
      className={`atlas earth-atlas ${region ? 'regional' : 'global'}`}
      data-map-ready={ready}
      data-visible-world-tiles={zones.length}
    >
      <div ref={container} className="earth-map" />
      <svg
        className="earth-cells"
        role="img"
        aria-label={t(region ? 'regionalMap' : 'worldMap')}
        viewBox={`0 0 ${view.width} ${view.height}`}
        data-camera={`${view.lng},${view.lat}`}
        data-zoom={view.zoom}
      >
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
            const fill = mine
              ? '#397952'
              : occupied
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
                fillOpacity={active ? 0.65 : occupied ? 0.48 : 0.14}
                stroke={active ? '#123b2a' : mine ? '#295839' : '#536c50'}
                strokeWidth={active ? 3 : 0.8}
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
          : t(zoneStride > 1 ? 'worldOverviewHint' : 'worldExploreHint')}
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
