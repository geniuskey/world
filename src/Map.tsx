import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  Compass,
  Flag,
  Focus,
  Globe2,
  Layers,
  Minus,
  Plus,
  RefreshCw,
  Sprout,
  TreePine,
  Mountain,
  Wheat,
  Zap,
} from 'lucide-react';
import { useWorld } from './state';
import { api, mutate, post } from './api';
import { Empty, Modal, Resource } from './components';
import {
  CHUNK_SIZE,
  facilityFor,
  terrainResource,
  type Region,
  type Territory,
} from '../shared/game';
import type { TextKey } from './i18n';

type Camera = { x: number; y: number; zoom: number };
function useCamera(regional: boolean, center?: { x: number; y: number }) {
  const ref = useRef<SVGSVGElement>(null),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    moved = useRef(false),
    distance = useRef(0);
  const [size, setSize] = useState({ width: 700, height: 560 });
  const initial = {
    x: regional ? (center?.x ?? 12) * 32 + 16 : 540,
    y: regional ? (center?.y ?? 12) * 32 + 16 : 245,
    zoom: regional ? 1.65 : 1,
  };
  const [camera, setCamera] = useState<Camera>(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = Math.min(size.width / (regional ? 768 : 1080), size.height / (regional ? 768 : 510));
  const scale = Math.max(0.1, fit * camera.zoom),
    width = size.width / scale,
    height = size.height / scale;
  const view = { x: camera.x - width / 2, y: camera.y - height / 2, width, height };
  const clamp = (value: Camera) => ({
    ...value,
    x: Math.min(regional ? 768 : 1080, Math.max(0, value.x)),
    y: Math.min(regional ? 768 : 540, Math.max(0, value.y)),
    zoom: Math.max(1, Math.min(5, value.zoom)),
  });
  const zoom = useCallback(
    (factor: number) => setCamera((c) => clamp({ ...c, zoom: c.zoom * factor })),
    [],
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY > 0 ? 0.88 : 1.14);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoom]);
  const pointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.size === 0) {
      moved.current = false;
      distance.current = 0;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const pointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    const all = [...pointers.current.entries()],
      other = all.find(([id]) => id !== e.pointerId)?.[1];
    const dx = e.clientX - previous.x,
      dy = e.clientY - previous.y;
    distance.current += Math.hypot(dx, dy);
    if (distance.current > 5) moved.current = true;
    if (other) {
      const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y),
        newDistance = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (oldDistance > 4)
        setCamera((c) =>
          clamp({
            ...c,
            zoom: (c.zoom * newDistance) / oldDistance,
            x: c.x - dx / scale / 2,
            y: c.y - dy / scale / 2,
          }),
        );
      moved.current = true;
    } else setCamera((c) => clamp({ ...c, x: c.x - dx / scale, y: c.y - dy / scale }));
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const pointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
  };
  return {
    ref,
    camera,
    setCamera,
    view,
    zoom,
    moved,
    reset: () => setCamera(initial),
    handlers: {
      onPointerDown: pointerDown,
      onPointerMove: pointerMove,
      onPointerUp: pointerUp,
      onPointerCancel: pointerUp,
    },
  };
}

function Atlas({
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
  const { t, regions, state, user, revision, fail } = useWorld();
  const navigate = useNavigate();
  const home = state?.territories.find((tile) => tile.region_id === region?.id);
  const { ref, camera, setCamera, view, zoom, moved, reset, handlers } = useCamera(
    Boolean(region),
    home,
  );
  const [tiles, setTiles] = useState<Territory[]>([]),
    [loading, setLoading] = useState(false),
    [mapError, setMapError] = useState(false);
  const chunks = useRef(new Map<string, Territory[]>()),
    loadedRevision = useRef(revision),
    generation = useRef(0);
  useEffect(() => {
    if (focus)
      setCamera((c) => ({
        ...c,
        x: focus.x * 32 + 16,
        y: focus.y * 32 + 16,
        zoom: Math.max(c.zoom, 2),
      }));
  }, [focus]);
  const minCX = Math.max(0, Math.floor(view.x / (32 * CHUNK_SIZE))),
    maxCX = Math.min(2, Math.floor((view.x + view.width) / (32 * CHUNK_SIZE)));
  const minCY = Math.max(0, Math.floor(view.y / (32 * CHUNK_SIZE))),
    maxCY = Math.min(2, Math.floor((view.y + view.height) / (32 * CHUNK_SIZE)));
  useEffect(() => {
    if (!region) return;
    const controller = new AbortController(),
      epoch = ++generation.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setMapError(false);
      const requests: Promise<Territory[]>[] = [];
      const fresh = loadedRevision.current !== revision;
      if (fresh) {
        chunks.current.clear();
        loadedRevision.current = revision;
      }
      for (let cy = minCY; cy <= maxCY; cy++)
        for (let cx = minCX; cx <= maxCX; cx++) {
          const key = `${cx}:${cy}`,
            cached = chunks.current.get(key);
          requests.push(
            cached
              ? Promise.resolve(cached)
              : api<{ tiles: Territory[] }>(`/map/chunks?region=${region.id}&cx=${cx}&cy=${cy}`, {
                  fresh,
                  signal: controller.signal,
                }).then((result) => {
                  if (!controller.signal.aborted) chunks.current.set(key, result.tiles);
                  return result.tiles;
                }),
          );
        }
      Promise.all(requests)
        .then((visible) => {
          if (epoch === generation.current) setTiles(visible.flat());
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            setMapError(true);
            fail(error);
          }
        })
        .finally(() => {
          if (epoch === generation.current) setLoading(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [region?.id, minCX, maxCX, minCY, maxCY, revision]);
  const cellAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (moved.current) return;
    const svg = ref.current,
      ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    if (!region) {
      const hit = regions.find((r) => {
        const dx = point.x - (r.longitude + 180) * 3,
          dy = point.y - (90 - r.latitude) * 3;
        return Math.hypot(dx, dy) < 24 || (Math.abs(dx) < 58 && dy > 23 && dy < 51);
      });
      if (hit) navigate(`/region/${hit.id}`);
      return;
    }
    const tile = tiles.find(
      (t) => t.x === Math.floor(point.x / 32) && t.y === Math.floor(point.y / 32),
    );
    if (tile) onSelect(tile);
  };
  return (
    <div className={`atlas ${region ? 'regional' : 'global'}`}>
      <div className="atlas-label">
        <span className="status-dot" />
        {region ? t(region.id as TextKey) : t('live')}
        <span className="atlas-coordinate">{region ? '24 × 24' : '180° W — 180° E'}</span>
      </div>
      <svg
        ref={ref}
        className="map-canvas"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        role="img"
        aria-label={t(region ? 'regionalMap' : 'worldMap')}
        {...handlers}
        onPointerUp={(e) => {
          cellAt(e);
          handlers.onPointerUp(e);
        }}
      >
        <defs>
          <pattern
            id="ocean-grid"
            width={region ? 32 : 90}
            height={region ? 32 : 90}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${region ? 32 : 90} 0 L 0 0 0 ${region ? 32 : 90}`}
              fill="none"
              stroke={region ? '#cadbd5' : '#cbdcd9'}
              strokeWidth="0.6"
            />
          </pattern>
          <pattern id="water-lines" width="14" height="14" patternUnits="userSpaceOnUse">
            <path d="M0 8q3-3 6 0t6 0" fill="none" stroke="#a3c7cc" strokeWidth=".7" />
          </pattern>
        </defs>
        <rect x="-2000" y="-2000" width="6000" height="6000" fill="url(#ocean-grid)" />
        {!region ? (
          <>
            <image href="/world.svg" x="0" y="0" width="1080" height="540" />
            <text className="ocean-label" x="120" y="320">
              PACIFIC OCEAN
            </text>
            <text className="ocean-label" x="490" y="290">
              ATLANTIC OCEAN
            </text>
            <text className="ocean-label" x="790" y="375">
              INDIAN OCEAN
            </text>
            {regions.map((r) => {
              const x = (r.longitude + 180) * 3,
                y = (90 - r.latitude) * 3;
              return (
                <g
                  key={r.id}
                  transform={`translate(${x},${y})`}
                  className="region-pin"
                  role="button"
                  tabIndex={0}
                  aria-label={t(r.id as TextKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/region/${r.id}`);
                    }
                  }}
                >
                  <circle r="25" fill="#3f715a" opacity=".1" />
                  <circle r="15" fill="#f7f9f1" stroke="#426f55" strokeWidth="1.4" />
                  <path d="M-3 6V-7l10 3-10 3" fill="none" stroke="#426f55" strokeWidth="1.7" />
                  <rect
                    x="-57"
                    y="24"
                    width="114"
                    height="26"
                    rx="13"
                    fill="#fcfcf6"
                    stroke="#c8d4c2"
                  />
                  <text y="41" textAnchor="middle" className="pin-label">
                    {t(r.id as TextKey)}
                  </text>
                </g>
              );
            })}
            <g transform="translate(900,420)" className="compass-rose">
              <path d="M0-30L6-6 30 0 6 6 0 30-6 6-30 0-6-6Z" fill="#93aaa0" opacity=".6" />
              <path d="M0-30V30M-30 0H30" stroke="#738f82" strokeWidth="1" />
              <text y="-38" textAnchor="middle">
                N
              </text>
            </g>
          </>
        ) : (
          tiles.map((tile) => {
            const mine = tile.owner_user_id === user?.id,
              occupied = Boolean(tile.owner_user_id),
              isSelected = selected === tile.id;
            const color =
              tile.terrain_type === 'water'
                ? '#c3dce0'
                : mine
                  ? '#7fa78b'
                  : occupied
                    ? '#d3b995'
                    : tile.terrain_type === 'forest'
                      ? '#b9d0af'
                      : tile.terrain_type === 'mountain'
                        ? '#d2d5ca'
                        : '#dde5c6';
            return (
              <g
                key={tile.id}
                transform={`translate(${tile.x * 32},${tile.y * 32})`}
                data-testid={`tile-${tile.x}-${tile.y}`}
                role="button"
                tabIndex={0}
                aria-label={`${t(tile.terrain_type)} ${tile.x}, ${tile.y}${mine ? ' ' + t('yours') : occupied ? ' ' + t('neighbors') : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(tile);
                  }
                }}
              >
                <rect
                  x=".8"
                  y=".8"
                  width="30.4"
                  height="30.4"
                  rx="2.5"
                  fill={color}
                  stroke={isSelected ? '#213e31' : mine ? '#4c785e' : '#a5b59d'}
                  strokeWidth={isSelected ? 2.8 : mine ? 1.1 : 0.35}
                />
                {tile.terrain_type === 'water' ? (
                  <rect x="1" y="1" width="30" height="30" fill="url(#water-lines)" />
                ) : tile.structure_type ? (
                  <g stroke={mine ? '#eaf1df' : '#728461'} fill="none" strokeWidth="1.5">
                    <path d="M10 23V13l6-6 6 6v10ZM8 14l8-8 8 8M14 23v-6h4v6" />
                  </g>
                ) : tile.terrain_type === 'forest' ? (
                  <g fill={mine ? '#4d7557' : '#6e9468'} opacity=".8">
                    <path d="M15 6l-6 10h3l-4 6h14l-4-6h3Z" />
                    <rect x="14" y="20" width="2" height="5" />
                  </g>
                ) : tile.terrain_type === 'mountain' ? (
                  <path
                    d="M6 23L16 7l10 16ZM12 14l4 2 4-2"
                    fill={mine ? '#557c66' : '#a0ad9a'}
                    stroke={mine ? '#557c66' : '#91a08c'}
                    strokeWidth=".8"
                  />
                ) : (
                  <g stroke={mine ? '#507e5b' : '#a7bd83'} strokeWidth="1.1">
                    <path d="M12 22v-5m0 2l-3-3m3 2l3-4M21 12v-4m0 2l-2-2" />
                  </g>
                )}
                {occupied && <circle cx="26" cy="6" r="2.5" fill={mine ? '#315d43' : '#a7754c'} />}
              </g>
            );
          })
        )}
      </svg>
      {region && (loading || mapError) && (
        <div className="map-loading" role="status">
          {t(mapError ? 'offline' : 'loadingMap')}
        </div>
      )}
      <div className="map-controls">
        <button className="icon-button" aria-label={t('zoomIn')} onClick={() => zoom(1.3)}>
          <Plus size={20} />
        </button>
        <button className="icon-button" aria-label={t('zoomOut')} onClick={() => zoom(1 / 1.3)}>
          <Minus size={20} />
        </button>
        <span />
        <button className="icon-button" aria-label={t('resetView')} onClick={reset}>
          <Focus size={19} />
        </button>
      </div>
      <div className="map-bottom">
        <span>{t('mapHint')}</span>
        <span>
          {region ? (
            t('logicalMap')
          ) : (
            <a
              href="https://www.naturalearthdata.com/about/terms-of-use/"
              target="_blank"
              rel="noreferrer"
            >
              {t('mapCredit')}
            </a>
          )}
        </span>
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
    </div>
  );
}

export function MapPage() {
  const { regionId, territoryId } = useParams(),
    navigate = useNavigate();
  const { t, config, regions, user, state, setAuthOpen, refresh, notify, fail, revision } =
    useWorld();
  const [tile, setTile] = useState<Territory | null>(null),
    [busy, setBusy] = useState(false),
    [focus, setFocus] = useState<{ x: number; y: number } | null>(null),
    [reportOpen, setReportOpen] = useState(false),
    [reason, setReason] = useState('');
  const region = regions.find((r) => r.id === (regionId || tile?.region_id));
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
    <main className="world-page">
      <section className="world-intro">
        <div>
          <span className="eyebrow">
            <span className="tiny-line" />
            {region ? t(region.id as TextKey) : t('tagline')}
          </span>
          <h1>{region ? t('regionIntro') : t('hero')}</h1>
          <p>{region ? t('mapHint') : t('heroBody')}</p>
        </div>
        <div className="intro-note">
          <Compass size={30} strokeWidth={1} />
          <span>{t('free')}</span>
        </div>
      </section>
      <div className="world-layout">
        <aside className="region-sidebar">
          <div className="sidebar-heading">
            <span>{t('regions')}</span>
            <span className="count-pill">03</span>
          </div>
          {regions.map((r, index) => (
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
                  {t(
                    r.id === 'han' ? 'eastAsia' : r.id === 'tagus' ? 'westEurope' : 'northAmerica',
                  )}
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
        </aside>
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
          <Atlas
            key={region?.id || 'global'}
            region={region}
            selected={tile?.id || null}
            onSelect={(value) => void select(value)}
            focus={focus}
          />
        </section>
        <aside className="detail-sidebar">
          {tile ? (
            <>
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
                  <div className="yield-box">
                    <span>{t('production')}</span>
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
