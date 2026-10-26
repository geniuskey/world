import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
const Atlas = lazy(() => import('./WorldAtlas').then((module) => ({ default: module.Atlas })));
import { coordinates, gridPoint, regionPlace } from '../shared/geography';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Compass,
  Share2,
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
import { usePlace } from './places';
import { placeName } from '../shared/places';
import { api, mutate, post } from './api';
import { Empty, Modal, Resource, terrainLabel } from './components';
import { worldTileFromId, WORLD_INITIAL_TILES } from '../shared/worldGrid';
import { parseTerritoryId, plotAt, plotTerritoryId, regionFor } from '../shared/plots';
import {
  landTax,
  plotPrice,
  terrainResource,
  type LandHistory,
  type Region,
  type Territory,
} from '../shared/game';
import type { TextKey } from './i18n';
import { LAND_COVER_SOURCE } from '../shared/landCover';

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
  const requestedRegion =
    regionId ||
    tile?.region_id ||
    (territoryId ? parseTerritoryId(territoryId)?.region : undefined);
  const [loadedRegion, setLoadedRegion] = useState<Region | null>(null);
  const [searchLng, setSearchLng] = useState('');
  const [searchLat, setSearchLat] = useState('');
  const region =
    (loadedRegion?.id === requestedRegion ? loadedRegion : null) ??
    regions.find((r) => r.id === requestedRegion) ??
    (requestedRegion && config ? regionFor(requestedRegion, config.season.id) : null) ??
    undefined;
  // Version 1 world-tile links (bookmarks, old URLs) open the plot region at their centre.
  useEffect(() => {
    const legacy = regionId ? worldTileFromId(regionId) : null;
    if (legacy)
      navigate(
        `/region/${plotAt((legacy.west + legacy.east) / 2, (legacy.south + legacy.north) / 2).region}`,
        { replace: true },
      );
  }, [regionId]);
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
      state?.territories.some((t) =>
        tile.gx != null
          ? t.gx != null && Math.abs(t.gx - tile.gx) + Math.abs(t.gy! - tile.gy!) === 1
          : t.region_id === tile.region_id && Math.abs(t.x - tile.x) + Math.abs(t.y - tile.y) === 1,
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
  const point = region && tile ? gridPoint(region, tile.x + 0.5, tile.y + 0.5) : null;
  const price = tile?.price_gold ?? plotPrice(tile?.population);
  const place = usePlace(point);
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
        <details className="region-sidebar" name="map-panel">
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
                <button className="text-link" aria-label={t('back')} onClick={() => navigate('/')}>
                  <ArrowLeft size={15} />
                  <span className="map-back-label">{t('back')}</span>
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
          <details className="coordinate-search" name="map-panel">
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
                  navigate(`/territory/${plotTerritoryId(config!.season.id, plotAt(lng, lat))}`);
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
                  {t('tile')} · {place ? t(terrainLabel(tile)) : region && t(region.id as TextKey)}
                </span>
                <h2>{place ? placeName(place.place, locale, true) : t(terrainLabel(tile))}</h2>
                {region && (
                  <div className="territory-location">
                    <strong>
                      {place ? placeName(place.place, locale) : regionPlace(region.id, locale)}
                    </strong>
                    <span>{coordinates(gridPoint(region, tile.x + 0.5, tile.y + 0.5))}</span>
                    <small>{t('geographicCell')}</small>
                    <small>
                      {tile.land_cover ? (
                        <>
                          {t('landCover')}: {t(`cover_${tile.land_cover}` as TextKey)} ·{' '}
                          <a
                            className="text-link"
                            href={LAND_COVER_SOURCE.url}
                            target="_blank"
                            rel="noreferrer"
                            title={LAND_COVER_SOURCE.attribution}
                          >
                            {LAND_COVER_SOURCE.name} ({LAND_COVER_SOURCE.license}) ↗
                          </a>
                        </>
                      ) : (
                        t('generatedTerrain')
                      )}
                    </small>
                    {place && (
                      <small>
                        {t('placeSource', { year: place.index.year })} ·{' '}
                        <a
                          className="text-link"
                          href={place.index.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('placeLicense')} ↗
                        </a>
                      </small>
                    )}
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
                    <>
                      {t('ownedBy')}{' '}
                      <Link className="text-link" to={`/player/${tile.owner_user_id}`}>
                        {tile.owner_name || '…'}
                      </Link>
                    </>
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
                  <>
                    {!tile.structure_type && (
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
                    )}
                    {config?.flags.land_trading && (
                      <LandTrade tile={tile} mine busy={busy} setBusy={setBusy} />
                    )}
                  </>
                ) : !tile.owner_user_id ? (
                  <>
                    <button
                      className="button primary full"
                      disabled={
                        busy ||
                        Boolean(
                          state &&
                          (!adjacent || state.energy_value < 1 || state.gold_balance < price),
                        ) ||
                        Date.now() / 1000 > config!.season.ends_at
                      }
                      onClick={() => void act('claim')}
                    >
                      <Flag size={17} />
                      {t('claim')}
                    </button>
                    <small className="cost-note" title={t('claimPrice')}>
                      <Zap size={12} />
                      {t('claimCost', { gold: price })}
                    </small>
                    {state && !adjacent && <p className="fine-print">{t('notAdjacent')}</p>}
                    {state && state.energy_value < 1 && (
                      <p className="fine-print">{t('noEnergy')}</p>
                    )}
                    {state && state.gold_balance < price && (
                      <p className="fine-print">{t('noGold', { gold: price })}</p>
                    )}
                  </>
                ) : config?.flags.land_trading ? (
                  <LandTrade tile={tile} mine={false} busy={busy} setBusy={setBusy} />
                ) : (
                  <p>{t('ownedHint')}</p>
                )}
                <LandRecord tile={tile} />
                <button
                  className="subtle-button"
                  onClick={() => {
                    const url = `${location.origin}/territory/${tile.id}`;
                    const where = place
                      ? placeName(place.place, locale, true)
                      : t(tile.region_id as TextKey);
                    const text = t(mine ? 'shareMine' : 'shareThis', { place: where });
                    if (navigator.share)
                      void navigator.share({ title: 'WORLD', text, url }).catch(() => {});
                    else
                      void navigator.clipboard
                        .writeText(`${text} ${url}`)
                        .then(() => notify('linkCopied'), fail);
                  }}
                >
                  <Share2 size={13} /> {t('share')}
                </button>
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

// Owned plots: market and buyout prices, listing for the owner, purchase for everyone else.
function LandTrade({
  tile,
  mine,
  busy,
  setBusy,
}: {
  tile: Territory;
  mine: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const { t, locale, config, user, state, setAuthOpen, refresh, notify, fail } = useWorld();
  const [ask, setAsk] = useState(tile.market_price_gold ?? 1);
  useEffect(() => setAsk(tile.market_price_gold ?? 1), [tile.id, tile.market_price_gold]);
  if (tile.buyout_price_gold == null) return null;
  const now = Date.now() / 1000,
    listing = tile.listing,
    buyout = tile.buyout_price_gold,
    price = listing?.price_gold ?? buyout,
    protectedUntil = !listing && (tile.protected_until ?? 0) > now ? tile.protected_until! : null,
    basis = mine ? (state?.territories.find((x) => x.id === tile.id)?.acquired_price ?? 0) : 0;
  const run = async (
    op: 'list' | 'unlist' | 'buy',
    body: Record<string, unknown>,
    done: TextKey,
  ) => {
    if (!user || !state) {
      setAuthOpen(true);
      return;
    }
    setBusy(true);
    try {
      await mutate(`/land/${tile.id}/${op}`, body);
      await refresh();
      notify(done);
    } catch (e) {
      fail(e);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const date = (seconds: number) =>
    new Date(seconds * 1000).toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
    });
  return (
    <div className="yield-box land-box">
      <dl>
        <dt>{t('landMarket')}</dt>
        <dd>
          <Resource kind="gold" amount={tile.market_price_gold ?? 0} />
        </dd>
        <dt>{t('landBuyout')}</dt>
        <dd>
          <Resource kind="gold" amount={buyout} />
        </dd>
      </dl>
      {listing && <strong>{t('landListedAt', { gold: listing.price_gold })}</strong>}
      {protectedUntil && <small>{t('landProtected', { date: date(protectedUntil) })}</small>}
      {mine ? (
        listing ? (
          <button
            className="button full"
            disabled={busy}
            onClick={() => void run('unlist', {}, 'landUnlisted')}
          >
            {t('landUnlist')}
          </button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run('list', { price_gold: ask }, 'landListed');
            }}
          >
            <label>
              {t('landAsk')}
              <input
                type="number"
                min={1}
                max={buyout}
                value={ask}
                onChange={(e) => setAsk(Number(e.target.value))}
                required
              />
            </label>
            <small>
              {t('landNet', { gold: ask - landTax(ask, basis), tax: landTax(ask, basis) })}
            </small>
            <button className="button full" disabled={busy}>
              {t('landList')}
            </button>
          </form>
        )
      ) : (
        <>
          <button
            className="button primary full"
            disabled={
              busy ||
              Boolean(protectedUntil) ||
              Boolean(state && (state.energy_value < 1 || state.gold_balance < price)) ||
              now > config!.season.ends_at
            }
            onClick={() => void run('buy', { price_gold: price }, 'landBought')}
          >
            <Flag size={17} />
            {t(listing ? 'landBuyListing' : 'landForceBuy', { gold: price })}
          </button>
          <small className="cost-note">
            <Zap size={12} />
            {t('claimCost', { gold: price })}
          </small>
          {state && state.energy_value < 1 && <p className="fine-print">{t('noEnergy')}</p>}
          {state && state.gold_balance < price && (
            <p className="fine-print">{t('noGoldBuy', { gold: price })}</p>
          )}
          <p className="fine-print">
            {t('landForceHint', { pct: config?.land?.buyout_premium_pct ?? 20 })}
          </p>
        </>
      )}
    </div>
  );
}

// The plot's permanent public record: its first settler and recent changes.
function LandRecord({ tile }: { tile: Territory }) {
  const { t, locale, revision } = useWorld();
  const [history, setHistory] = useState<LandHistory | null>(null);
  useEffect(() => {
    let current = true;
    setHistory(null);
    if (tile.owner_user_id)
      void api<LandHistory>(`/territories/${tile.id}/history`, { fresh: true })
        .then((result) => current && setHistory(result))
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [tile.id, tile.owner_user_id, revision]);
  if (!history?.first) return null;
  const date = (seconds: number) =>
    new Date(seconds * 1000).toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US');
  const who = (id: string, name: string | null) => (
    <Link className="text-link" to={`/player/${id}`}>
      {name || t('formerSettler')}
    </Link>
  );
  const action = { join: 'eventJoin', claim: 'eventClaim', build: 'eventBuild' } as const;
  return (
    <section className="land-record" aria-label={t('landRecord')}>
      <span className="eyebrow">{t('landRecord')}</span>
      <p>
        {t('firstSettler')} {who(history.first.user_id, history.first.display_name)} ·{' '}
        {date(history.first.at)}
      </p>
      <ol>
        {history.events.slice(0, 5).map((event, i) => (
          <li key={i}>
            <span>
              {who(event.user_id, event.display_name)}{' '}
              {t(
                event.type === 'buy'
                  ? event.kind === 'buyout'
                    ? 'eventBuyout'
                    : 'eventBought'
                  : action[event.type],
                { gold: event.price_gold ?? 0 },
              )}
              {event.type === 'buy' && event.seller_user_id && (
                <> · {who(event.seller_user_id, event.seller_name)}</>
              )}
            </span>
            <small>{date(event.created_at)}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
