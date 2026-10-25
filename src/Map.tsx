import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
const Atlas = lazy(() => import('./WorldAtlas').then((module) => ({ default: module.Atlas })));
import { coordinates, gridPoint, regionPlace } from '../shared/geography';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Compass,
  Flag,
  Globe2,
  Layers,
  RefreshCw,
  Sprout,
  TreePine,
  Mountain,
  Wheat,
  Zap,
  Users,
  X,
} from 'lucide-react';
import { useWorld } from './state';
import { api, mutate, post } from './api';
import { Empty, Modal, Resource } from './components';
import {
  rootTileAt,
  worldTileFromId,
  regionForTile,
  WORLD_INITIAL_TILES,
} from '../shared/worldGrid';
import { terrainResource, type Region, type Territory } from '../shared/game';
import type { TextKey } from './i18n';

export function MapPage() {
  const { regionId, territoryId } = useParams(),
    navigate = useNavigate();
  const { t, locale, config, regions, user, state, setAuthOpen, refresh, notify, fail, revision } =
    useWorld();
  const [tile, setTile] = useState<Territory | null>(null),
    [busy, setBusy] = useState(false),
    [focus, setFocus] = useState<{ x: number; y: number } | null>(null),
    [reportOpen, setReportOpen] = useState(false),
    [reason, setReason] = useState('');
  const requestedRegion = regionId || tile?.region_id;
  const [loadedRegion, setLoadedRegion] = useState<Region | null>(null);
  const [searchLng, setSearchLng] = useState('');
  const [searchLat, setSearchLat] = useState('');
  const virtual = requestedRegion ? worldTileFromId(requestedRegion) : null;
  const region =
    (loadedRegion?.id === requestedRegion ? loadedRegion : null) ??
    regions.find((r) => r.id === requestedRegion) ??
    (virtual && config ? regionForTile(virtual, config.season.id) : undefined);
  useEffect(() => {
    if (!requestedRegion) return;
    const controller = new AbortController();
    void api<{ region: Region }>(`/regions/${requestedRegion}`, {
      signal: controller.signal,
      fresh: revision > 0,
    })
      .then((result) => {
        if (!controller.signal.aborted) setLoadedRegion(result.region);
      })
      .catch((error) => {
        if (!controller.signal.aborted) fail(error);
      });
    return () => controller.abort();
  }, [requestedRegion, revision]);
  useEffect(() => {
    let cancelled = false;
    setTile(null);
    setFocus(null);
    if (territoryId)
      void api<{ territory: Territory }>(`/territories/${territoryId}`)
        .then((r) => {
          if (cancelled) return;
          setTile(r.territory);
          setFocus(r.territory);
        })
        .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [regionId, territoryId]);
  useEffect(() => {
    if (tile)
      void api<{ territory: Territory }>(`/territories/${tile.id}`)
        .then((r) => setTile((current) => (current?.id === r.territory.id ? r.territory : current)))
        .catch(fail);
  }, [revision]);
  const select = async (value: Territory) => {
    setTile(value);
    try {
      const result = await api<{ territory: Territory }>(`/territories/${value.id}`);
      setTile((current) => (current?.id === value.id ? result.territory : current));
      if (user) void post('/events', { event: 'territory' }).catch(() => {});
    } catch (e) {
      fail(e);
    }
  };
  const mine = tile?.owner_user_id === user?.id && Boolean(user),
    adjacent =
      tile &&
      state?.territories.some(
        (t) =>
          t.region_id === tile.region_id && Math.abs(t.x - tile.x) + Math.abs(t.y - tile.y) === 1,
      );
  const act = async (type: 'claim' | 'build') => {
    if (!user || !state) {
      setAuthOpen(true);
      return;
    }
    if (!tile) return;
    setBusy(true);
    try {
      await mutate(type === 'claim' ? '/actions/claim' : '/structures/build', {
        territory_id: tile.id,
      });
      await refresh();
      notify(type === 'claim' ? 'claimSuccess' : 'buildSuccess');
    } catch (e) {
      fail(e);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const terrain = tile?.terrain_type,
    resource = terrain && terrain !== 'water' ? terrainResource[terrain] : null;
  const stats = useMemo(
    () =>
      regions.reduce((a, r) => ({ owned: a.owned + r.owned, open: a.open + r.available }), {
        owned: 0,
        open: 0,
      }),
    [regions],
  );
  return (
    <main className="world-page map-first">
      <section className="world-intro">
        <div>
          <span className="eyebrow">
            <span className="tiny-line" />
            {region ? t(region.id as TextKey) : t('tagline')}
          </span>
          <h1>{region ? t('regionIntro') : t('hero')}</h1>
          <p>{region ? regionPlace(region.id, locale) : t('heroBody')}</p>
          {config?.world_grid && (
            <p className="fine-print">
              {t(config.world_grid.auto_split ? 'worldGridRule' : 'worldGridReady', {
                count: config.world_grid.initial_tiles.toLocaleString(
                  locale === 'ko' ? 'ko-KR' : 'en-US',
                ),
                players: config.world_grid.split_players,
              })}
            </p>
          )}
        </div>
        <div className="intro-note">
          <Compass size={30} strokeWidth={1} />
          <span>{t('free')}</span>
        </div>
      </section>
      <div className="world-layout">
        <details className="region-sidebar">
          <summary>
            <Globe2 size={16} />
            {t('regions')}
          </summary>
          <div className="region-options">
            {!regions.length && !region && <p className="notice">{t('noExploredRegions')}</p>}
            <div className="sidebar-heading">
              <span>{t('regions')}</span>
              <span className="count-pill">{WORLD_INITIAL_TILES.toLocaleString()}</span>
            </div>
            {[...regions, ...(region && !regions.some((r) => r.id === region.id) ? [region] : [])]
              .filter((r) => r.world_level != null)
              .map((r, index) => (
                <Link
                  key={r.id}
                  to={`/region/${r.id}`}
                  className={`region-card ${region?.id === r.id ? 'selected' : ''}`}
                >
                  <div className={`region-thumb ${r.id}`}>
                    <span className="terrain-lines" />
                    <span className="region-index">0{index + 1}</span>
                    <Flag size={20} />
                  </div>
                  <div className="region-card-text">
                    <small>
                      {t(r.world_split ? 'worldTileSplit' : 'worldTileLevel', {
                        level: r.world_level ?? 0,
                      })}
                    </small>
                    <h3>
                      {t(r.id as TextKey)}
                      <ArrowUpRightIcon />
                    </h3>
                    <span>
                      <i className="status-dot" />
                      {r.available} {t('available')}
                    </span>
                  </div>
                </Link>
              ))}
            <div className="world-counts">
              <span className="eyebrow">{t('atlas')}</span>
              <div>
                <strong>{stats.owned.toLocaleString()}</strong>
                <span>{t('settlers')}</span>
              </div>
              <div>
                <strong>{stats.open.toLocaleString()}</strong>
                <span>{t('available')}</span>
              </div>
            </div>
            <Link to="/rules" className="text-link">
              {t('rules')}
              <ArrowRight size={15} />
            </Link>
          </div>
        </details>
        <section className="map-section">
          <div className="map-toolbar">
            <div>
              {region ? (
                <button className="text-link" onClick={() => navigate('/')}>
                  <ArrowLeft size={15} />
                  {t('back')}
                </button>
              ) : (
                <span>
                  <Globe2 size={17} />
                  {t('worldMap')}
                </span>
              )}
            </div>
            <div>
              {state && (
                <button
                  className="icon-button"
                  aria-label={t('focusHome')}
                  onClick={() => {
                    const own =
                      state.territories.find((t) => t.region_id === region?.id) ||
                      state.territories[0];
                    if (own) {
                      if (own.region_id !== region?.id) navigate(`/territory/${own.id}`);
                      else setFocus({ x: own.x, y: own.y });
                    }
                  }}
                >
                  <Flag size={16} />
                </button>
              )}
              <button
                className="icon-button"
                aria-label={t('refresh')}
                onClick={() => void refresh().catch(fail)}
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
          <details className="coordinate-search">
            <summary>
              <Compass size={15} />
              {t('coordinateSearch')}
            </summary>
            <form
              className="world-tile-picker"
              onSubmit={(event) => {
                event.preventDefault();
                const lng = Number(searchLng),
                  lat = Number(searchLat);
                if (
                  Number.isFinite(lng) &&
                  Number.isFinite(lat) &&
                  Math.abs(lng) <= 180 &&
                  Math.abs(lat) <= 90
                )
                  navigate(`/region/${rootTileAt(lng, lat).id}`);
              }}
            >
              <label>
                {t('longitude')}
                <input
                  aria-label={t('longitude')}
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  required
                  value={searchLng}
                  onChange={(event) => setSearchLng(event.target.value)}
                />
              </label>
              <label>
                {t('latitude')}
                <input
                  aria-label={t('latitude')}
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  required
                  value={searchLat}
                  onChange={(event) => setSearchLat(event.target.value)}
                />
              </label>
              <button className="button primary small" type="submit">
                {t('chooseWorldTile')}
              </button>
            </form>
          </details>
          <Suspense
            fallback={
              <div className="atlas" role="status">
                {t('loadingMap')}
              </div>
            }
          >
            <Atlas
              key={region?.id || 'global'}
              region={region}
              selected={tile?.id || null}
              onSelect={(value) => void select(value)}
              focus={focus}
            />
          </Suspense>
        </section>
        <aside className={`detail-sidebar ${tile ? 'has-selection' : 'map-welcome'}`}>
          {tile ? (
            <>
              <button
                className="icon-button close-detail"
                aria-label={t('close')}
                onClick={() => setTile(null)}
              >
                <X size={18} />
              </button>
              <div className={`tile-art ${terrain}`}>
                <div className="tile-isometric">
                  {terrain === 'forest' ? (
                    <TreePine size={64} strokeWidth={1.1} />
                  ) : terrain === 'mountain' ? (
                    <Mountain size={64} strokeWidth={1.1} />
                  ) : terrain === 'water' ? (
                    <Layers size={64} strokeWidth={1.1} />
                  ) : (
                    <Wheat size={64} strokeWidth={1.1} />
                  )}
                </div>
                <span className="tile-coordinates">
                  {String(tile.x).padStart(2, '0')} / {String(tile.y).padStart(2, '0')}
                </span>
              </div>
              <div className="detail-content">
                <span className="eyebrow">
                  {t('tile')} · {region && t(region.id as TextKey)}
                </span>
                <h2>{t(terrain!)}</h2>
                {region && (
                  <div className="territory-location">
                    <strong>{regionPlace(region.id, locale)}</strong>
                    <span>{coordinates(gridPoint(region, tile.x + 0.5, tile.y + 0.5))}</span>
                    <small>{t('geographicCell')}</small>
                    <a
                      className="text-link"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.openstreetmap.org/?mlat=${gridPoint(region, tile.x + 0.5, tile.y + 0.5)[1]}&mlon=${gridPoint(region, tile.x + 0.5, tile.y + 0.5)[0]}#map=16/${gridPoint(region, tile.x + 0.5, tile.y + 0.5)[1]}/${gridPoint(region, tile.x + 0.5, tile.y + 0.5)[0]}`}
                    >
                      {t('viewRealLocation')} ↗
                    </a>
                  </div>
                )}
                <p className="ownership">
                  {mine ? (
                    <>
                      <span className="status-dot" />
                      {t('yours')}
                    </>
                  ) : tile.owner_user_id ? (
                    `${t('ownedBy')} ${tile.owner_name || '…'}`
                  ) : (
                    t('noOwner')
                  )}
                </p>
                {resource && (
                  <div className="population-card">
                    <span className="eyebrow">
                      <Users size={16} />
                      {t('citizens')}
                    </span>
                    <strong>
                      {tile.population == null
                        ? '—'
                        : Math.round(tile.population).toLocaleString(
                            locale === 'ko' ? 'ko-KR' : 'en-US',
                          )}
                    </strong>
                    <p>
                      {tile.population == null
                        ? t('populationPending')
                        : t('populationEstimate', { year: tile.population_year ?? '—' })}
                    </p>
                    <div className="population-income">
                      <span>{t('citizenIncome')}</span>
                      <Resource kind="gold" amount={Math.floor((tile.population ?? 0) / 100)} />
                    </div>
                    <small>{t('populationRate')}</small>
                    {tile.population_source && (
                      <a
                        className="text-link"
                        href={tile.population_source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('populationSource')} ↗
                      </a>
                    )}
                  </div>
                )}
                {resource && (
                  <div className="yield-box">
                    <span>{t('basicProduction')}</span>
                    <div>
                      <Resource kind={resource} amount={tile.structure_type ? 4 : 2} />
                      <span>+</span>
                      <Resource kind="gold" amount={1} />
                    </div>
                    <small>{t('perTurn')}</small>
                  </div>
                )}
                {tile.structure_type && (
                  <div className="facility-badge">
                    <Sprout size={19} />
                    <span>
                      {t(tile.structure_type as TextKey)}
                      <small>{t('built')}</small>
                    </span>
                  </div>
                )}
                {terrain === 'water' ? (
                  <p>{t('waterHint')}</p>
                ) : mine ? (
                  !tile.structure_type && (
                    <>
                      <p>{t('buildHint')}</p>
                      <button
                        className="button primary full"
                        disabled={busy || Date.now() / 1000 > config!.season.ends_at}
                        onClick={() => void act('build')}
                      >
                        <Sprout size={17} />
                        {t('build')}
                      </button>
                      <small className="cost-note">{t('buildCost')}</small>
                    </>
                  )
                ) : !tile.owner_user_id ? (
                  <>
                    <button
                      className="button primary full"
                      disabled={
                        busy ||
                        Boolean(state && (!adjacent || state.energy_value < 1)) ||
                        Date.now() / 1000 > config!.season.ends_at
                      }
                      onClick={() => void act('claim')}
                    >
                      <Flag size={17} />
                      {t('claim')}
                    </button>
                    <small className="cost-note">
                      <Zap size={12} />
                      {t('claimCost')}
                    </small>
                    {state && !adjacent && <p className="fine-print">{t('notAdjacent')}</p>}
                    {state && state.energy_value < 1 && (
                      <p className="fine-print">{t('noEnergy')}</p>
                    )}
                  </>
                ) : (
                  <p>{t('ownedHint')}</p>
                )}
                {user && tile.owner_user_id && !mine && (
                  <button className="subtle-button" onClick={() => setReportOpen(true)}>
                    {t('report')}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="welcome-panel">
              <div className="little-world">
                <div className="little-hill" />
                <TreePine size={50} strokeWidth={1.1} />
                <Flag size={27} strokeWidth={1.3} />
                <Sprout size={27} strokeWidth={1.4} />
              </div>
              <span className="eyebrow">{t('yourChapter')}</span>
              <h2>{t('selectTile')}</h2>
              <p>{t('selectHint')}</p>
              {!state && (
                <button className="button primary full" onClick={() => setAuthOpen(true)}>
                  {t('settle')}
                  <ArrowRight size={16} />
                </button>
              )}
              <div className="rhythm">
                <span>
                  <Zap size={17} />
                  {t('dailyRhythm')}
                </span>
                <p>{t('dailyBody')}</p>
              </div>
              <p className="fine-print">{t('privacy')}</p>
            </div>
          )}
        </aside>
      </div>
      {reportOpen && (
        <Modal title={t('report')} onClose={() => setReportOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post('/reports', { target_type: 'territory', target_id: tile!.id, reason });
                notify('reportSent');
                setReportOpen(false);
                setReason('');
              } catch (e) {
                fail(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('reportReason')}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={5}
                maxLength={500}
                required
              />
            </label>
            <button className="button primary" disabled={busy}>
              {t('sendReport')}
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
function ArrowUpRightIcon() {
  return <ArrowDownLeft size={15} style={{ transform: 'rotate(180deg)' }} />;
}
