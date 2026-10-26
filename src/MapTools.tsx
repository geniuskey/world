import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck, Layers, Navigation, Search, X } from 'lucide-react';
import { useWorld } from './state';
import { api, ApiFailure } from './api';
import type { Region, Territory } from '../shared/game';
import { worldTileFromId, worldTileName, type WorldTile } from '../shared/worldGrid';
import {
  measureDistance,
  regionLandmarks,
  type MapActivity,
  type MapLayers,
  type PopulationSample,
} from '../shared/mapFeatures';
import type { TextKey } from './i18n';

export const landmarkKeys = {
  peak: 'mapPeak',
  lake: 'mapLake',
  grove: 'mapGrove',
  ruins: 'mapRuins',
} as const;
export const activityKeys = {
  join: 'mapActivityJoin',
  claim: 'mapActivityClaim',
  build: 'mapActivityBuild',
} as const;
export const landmarkIcons = { peak: '▲', lake: '≈', grove: '♣', ruins: '⌂' } as const;

export function useMapActivity(region: string | undefined, enabled: boolean, revision: number) {
  const [activities, setActivities] = useState<MapActivity[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const data = await api<{ activities: MapActivity[] }>(
          `/map/activity${region ? `?region=${encodeURIComponent(region)}` : ''}`,
          { signal: controller.signal, fresh: true },
        );
        if (!controller.signal.aborted) {
          setActivities(data.activities);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [region, enabled, revision, retry]);
  return { activities, error, loading, retry: () => setRetry((value) => value + 1) };
}

export function MapTools({
  region,
  tiles,
  layers,
  setLayers,
  bookmarks,
  setBookmarks,
  storageError,
  measuring,
  setMeasuring,
  points,
  clearPoints,
  onFocus,
  activities,
  activityError,
  activityLoading,
  retryActivity,
  onActivityOpen,
  population,
  populationError,
  populationLoading,
  retryPopulation,
}: {
  region?: Region;
  tiles: Territory[];
  layers: MapLayers;
  setLayers: (layers: MapLayers) => void;
  bookmarks: string[];
  setBookmarks: (ids: string[]) => void;
  storageError: boolean;
  measuring: boolean;
  setMeasuring: (value: boolean) => void;
  points: [number, number][];
  clearPoints: () => void;
  onFocus: (tile: Territory) => void;
  activities: MapActivity[];
  activityError: boolean;
  activityLoading: boolean;
  retryActivity: () => void;
  onActivityOpen: (open: boolean) => void;
  population: PopulationSample[];
  populationError: boolean;
  populationLoading: boolean;
  retryPopulation: () => void;
}) {
  const { t, locale, regions } = useWorld();
  const [tab, setTab] = useState('mapSearch');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorldTile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const known = [
    ...new Set([...regions.map((value) => value.id), ...bookmarks, ...(region ? [region.id] : [])]),
  ].join(',');
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    setResults([]);
    let worker: Worker | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('./regionSearch.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (event: MessageEvent<WorldTile[]>) => {
          worker?.terminate();
          void Promise.all(
            event.data.map(async (tile) => {
              if (tile.level === 0) return tile;
              try {
                await api(`/regions/${tile.id}`, { signal: controller.signal });
                return tile;
              } catch (error) {
                if (error instanceof ApiFailure && error.status === 404) return null;
                throw error;
              }
            }),
          )
            .then((matches) => {
              if (!controller.signal.aborted) {
                setResults(matches.filter((tile): tile is WorldTile => tile !== null));
                setSearching(false);
              }
            })
            .catch(() => {
              if (!controller.signal.aborted) {
                setSearchError(true);
                setSearching(false);
              }
            });
        };
        worker.onerror = () => {
          setSearchError(true);
          setSearching(false);
          worker?.terminate();
        };
        worker.postMessage({ query, locale, known: known.split(',') });
      } catch {
        setSearchError(true);
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
      controller.abort();
    };
  }, [query, locale, known, searchRetry]);
  const landmarks = useMemo(() => regionLandmarks(tiles), [tiles]);
  const distance = points.length === 2 ? measureDistance(points[0], points[1]) : null;
  const saved = region ? bookmarks.includes(region.id) : false;
  const toggleBookmark = (id: string) =>
    setBookmarks(
      bookmarks.includes(id)
        ? bookmarks.filter((value) => value !== id)
        : [...bookmarks, id].slice(0, 100),
    );
  const resultList = (items: WorldTile[], removable = false) => (
    <ul className="map-place-list">
      {items.map((tile) => (
        <li key={tile.id}>
          <Link to={`/region/${tile.id}`}>{worldTileName(tile, locale)}</Link>
          {removable && (
            <button
              type="button"
              className="icon-button"
              aria-label={`${t('mapUnsave')}: ${worldTileName(tile, locale)}`}
              onClick={() => toggleBookmark(tile.id)}
            >
              <X size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <details
      className="map-tools"
      name="map-panel"
      onToggle={(event) => onActivityOpen(event.currentTarget.open && tab === 'mapActivity')}
    >
      <summary>
        <Layers size={16} />
        {t('mapTools')}
        {measuring && <span className="measure-live" />}
      </summary>
      <div className="map-tools-body">
        <div className="map-tool-tabs" role="tablist" aria-label={t('mapTools')}>
          {(['mapSearch', 'mapLayers', 'mapDiscover', 'mapActivity', 'mapMeasure'] as const).map(
            (key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-controls="map-tool-panel"
                aria-selected={tab === key}
                onClick={(event) => {
                  setTab(key);
                  onActivityOpen(
                    key === 'mapActivity' && !!event.currentTarget.closest('details')?.open,
                  );
                }}
              >
                {t(key)}
              </button>
            ),
          )}
        </div>
        <div role="tabpanel" id="map-tool-panel" aria-labelledby={`tab-${tab}`}>
          {tab === 'mapSearch' && (
            <>
              <label className="map-search-input">
                <Search size={15} />
                <input
                  aria-label={t('mapSearchLabel')}
                  placeholder={t('mapSearchLabel')}
                  value={query}
                  maxLength={160}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <p className="map-tool-note">{t('mapSearchHint')}</p>
              <div aria-live="polite">
                {searching ? (
                  <p>{t('mapSearching')}</p>
                ) : searchError ? (
                  <p>
                    {t('mapSearchError')}{' '}
                    <button onClick={() => setSearchRetry((value) => value + 1)}>
                      {t('retry')}
                    </button>
                  </p>
                ) : query.trim() && !results.length ? (
                  <p>{t('mapNoResults')}</p>
                ) : (
                  resultList(results)
                )}
              </div>
              {results.length >= 16 && <p className="map-tool-note">{t('mapResultsHint')}</p>}
              <div className="map-tool-heading">
                <h3>
                  <Bookmark size={14} />
                  {t('mapBookmarks')}
                </h3>
                {region && (
                  <button
                    type="button"
                    className="map-save-button"
                    aria-label={t(saved ? 'mapUnsave' : 'mapSave')}
                    disabled={!saved && bookmarks.length >= 100}
                    onClick={() => toggleBookmark(region.id)}
                  >
                    {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                    {t(saved ? 'mapUnsave' : 'mapSave')}
                  </button>
                )}
              </div>
              {bookmarks.length ? (
                resultList(
                  bookmarks.flatMap((id) => {
                    const tile = worldTileFromId(id);
                    return tile ? [tile] : [];
                  }),
                  true,
                )
              ) : (
                <p className="map-tool-note">{t('mapNoBookmarks')}</p>
              )}
              <p className="map-tool-note">
                {t(storageError ? 'mapStorageError' : 'mapLocalSave')}
              </p>
            </>
          )}
          {tab === 'mapLayers' && (
            <>
              <label className="map-layer-select">
                {t('mapResources')}
                <select
                  value={layers.resources}
                  onChange={(event) =>
                    setLayers({
                      ...layers,
                      resources: event.target.value as MapLayers['resources'],
                    })
                  }
                >
                  {(['off', 'all', 'food', 'wood', 'iron'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(
                        value === 'off'
                          ? 'mapLayerOff'
                          : value === 'all'
                            ? 'mapAllResources'
                            : value,
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <p className="map-tool-note">{t('mapResourceHint')}</p>
              {(['population', 'ownership', 'landmarks', 'activity'] as const).map((key) => (
                <label className="map-layer-toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(event) => setLayers({ ...layers, [key]: event.target.checked })}
                  />
                  {t(
                    (
                      {
                        population: 'mapPopulation',
                        ownership: 'mapOwnership',
                        landmarks: 'mapLandmarks',
                        activity: 'mapActivityLayer',
                      } as const
                    )[key],
                  )}
                </label>
              ))}
              {!region && <p className="map-tool-note">{t('mapRegionalLayers')}</p>}
              {layers.population && region && (
                <div className="map-population-key">
                  <p>{t('mapPopulationHint')}</p>
                  <div className="map-density-gradient" />
                  <small>{t('mapDensityScale')}</small>
                  <p role="status">
                    {populationLoading
                      ? t('loadingMap')
                      : populationError
                        ? t('mapUnavailable')
                        : population.length
                          ? t('populationCoverage', {
                              known: population.length,
                              total: tiles.length,
                            })
                          : t('mapNoPopulation')}
                  </p>
                  {populationError && (
                    <button onClick={retryPopulation}>{t('mapRefreshData')}</button>
                  )}
                </div>
              )}
              {storageError && <p className="map-tool-note">{t('mapStorageError')}</p>}
            </>
          )}
          {tab === 'mapDiscover' && (
            <>
              <p className="map-tool-note">{t('mapLandmarkHint')}</p>
              <label className="map-layer-toggle">
                <input
                  type="checkbox"
                  checked={layers.landmarks}
                  onChange={(event) => setLayers({ ...layers, landmarks: event.target.checked })}
                />
                {t('mapLandmarks')}
              </label>
              {!region ? (
                <p>{t('mapRegionalLayers')}</p>
              ) : !landmarks.length ? (
                <p>{t('mapNoLandmarks')}</p>
              ) : (
                <ul className="map-place-list">
                  {landmarks.map((landmark) => (
                    <li key={landmark.id}>
                      <button
                        className="map-list-button"
                        onClick={(event) => {
                          const tools = event.currentTarget.closest('details');
                          if (tools) tools.open = false;
                          setLayers({ ...layers, landmarks: true });
                          onFocus(landmark.tile);
                        }}
                      >
                        <span className="landmark-symbol">{landmarkIcons[landmark.kind]}</span>
                        <span>
                          {t(landmarkKeys[landmark.kind])}
                          <small>
                            {landmark.tile.x + 1}-{landmark.tile.y + 1}
                          </small>
                        </span>
                        <Navigation size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {tab === 'mapActivity' && (
            <>
              <p className="map-tool-note">{t('mapActivityHint')}</p>
              <label className="map-layer-toggle">
                <input
                  type="checkbox"
                  checked={layers.activity}
                  onChange={(event) => setLayers({ ...layers, activity: event.target.checked })}
                />
                {t('mapActivityLayer')}
              </label>
              {activityError ? (
                <p role="status">
                  {t('mapActivityError')} <button onClick={retryActivity}>{t('retry')}</button>
                </p>
              ) : activityLoading && !activities.length ? (
                <p role="status">{t('loadingMap')}</p>
              ) : !activities.length ? (
                <p role="status">{t('mapNoActivity')}</p>
              ) : (
                <ul className="map-place-list map-activity-list">
                  {activities.map((activity) => (
                    <li key={activity.id}>
                      <Link to={`/territory/${activity.territory_id}`}>
                        <span>
                          {t(activityKeys[activity.type])} · {activity.actor_name}
                        </span>
                        <small>
                          {t(activity.region_id as TextKey)} · {activity.x + 1}-{activity.y + 1}
                        </small>
                        <time dateTime={new Date(activity.created_at * 1000).toISOString()}>
                          {new Date(activity.created_at * 1000).toLocaleString(
                            locale === 'ko' ? 'ko-KR' : 'en-US',
                          )}
                        </time>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {tab === 'mapMeasure' && (
            <>
              <p className="map-tool-note">{t('mapMeasureHint')}</p>
              <button
                className="button small"
                aria-pressed={measuring}
                onClick={(event) => {
                  setMeasuring(!measuring);
                  if (!measuring) {
                    clearPoints();
                    const tools = event.currentTarget.closest('details');
                    if (tools) tools.open = false;
                  }
                }}
              >
                {t(measuring ? 'mapStopMeasure' : 'mapStartMeasure')}
              </button>
              {points.length > 0 && (
                <button className="map-clear-measure" onClick={clearPoints}>
                  {t('mapClearMeasure')}
                </button>
              )}
              {measuring && (
                <p role="status">
                  {t(
                    points.length === 0
                      ? 'mapMeasureFirst'
                      : points.length === 1
                        ? 'mapMeasureSecond'
                        : 'mapMeasureApprox',
                  )}
                </p>
              )}
              {distance && (
                <dl className="map-measure-result">
                  <div>
                    <dt>{t('mapDistance')}</dt>
                    <dd>
                      {distance.meters < 1000
                        ? `${distance.meters.toFixed(1)} m`
                        : `${(distance.meters / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} km`}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('mapBearing')}</dt>
                    <dd>{distance.bearing.toFixed(1)}°</dd>
                  </div>
                </dl>
              )}
            </>
          )}
        </div>
      </div>
    </details>
  );
}
