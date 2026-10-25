import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  Coins,
  Flag,
  Leaf,
  Plus,
  Search,
  Shield,
  ShoppingBasket,
  Sparkles,
  Sprout,
  Trophy,
  Zap,
} from 'lucide-react';
import { useWorld } from './state';
import { api, mutate, post } from './api';
import { Empty, Modal, PageHeading, Resource, resourceIcon } from './components';
import { RESOURCE_KINDS, tradeTax, type Order, type Rank, type ResourceKind } from '../shared/game';
import type { TextKey } from './i18n';

type Entry = {
  delta: number;
  reason: string;
  created_at: number;
  kind?: ResourceKind;
  ref_id: string;
};
function useData<T>(path: string) {
  const { revision, message } = useWorld();
  const generation = useRef(0);
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const load = async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (request !== generation.current) return;
      setData(result);
      setError('');
    } catch (e) {
      if (request === generation.current) setError(message(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [path, revision]);
  return { data, error, loading, load };
}
export function AccountPage() {
  const { t, state, user, setAuthOpen, refresh, notify, fail } = useWorld();
  const [name, setName] = useState(user?.display_name || ''),
    [flag, setFlag] = useState(user?.flag_style || 'fern'),
    [busy, setBusy] = useState(false);
  const [transactions, setTransactions] = useState<{
    gold: Entry[];
    resources: Entry[];
    history: { season_id: string; territory_count: number; produced_total: number }[];
  } | null>(null);
  useEffect(() => {
    if (state) void api<typeof transactions>('/me/transactions').then(setTransactions).catch(fail);
  }, [state]);
  useEffect(() => {
    if (user) {
      setName(user.display_name);
      setFlag(user.flag_style);
    }
  }, [user?.id]);
  if (!state)
    return (
      <main className="page">
        <Empty title={t('noTerritory')} body={t('noTerritoryBody')}>
          <button className="button primary" onClick={() => setAuthOpen(true)}>
            {t(user ? 'joinSeason' : 'settle')}
            <ArrowRight size={17} />
          </button>
        </Empty>
      </main>
    );
  const milestones = (['pioneer', 'grower', 'builder'] as const).map(
    (kind) => [kind, state.achievements.some((a) => a.kind === kind)] as const,
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/me/profile', {
        display_name: name,
        flag_style: flag,
        locale: state.user.locale,
      });
      await refresh();
      notify('saved');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page">
      <PageHeading eyebrow={t('yourChapter')} title={t('estateTitle')} body={t('estateBody')}>
        <Link className="button primary" to={`/territory/${state.territories[0].id}`}>
          {t('focusHome')}
          <ArrowUpRight size={17} />
        </Link>
      </PageHeading>
      <div className="stat-grid">
        <div className="stat-card">
          <Flag size={22} />
          <small>{t('land')}</small>
          <strong>{state.territory_count}</strong>
          <span>
            {t('season')} {state.season.id}
          </span>
        </div>
        <div className="stat-card">
          <Zap size={22} />
          <small>{t('energy')}</small>
          <strong>
            {state.energy_value}
            <em>/ 4</em>
          </strong>
          <span>
            {state.next_energy_at
              ? `${t('nextEnergy')} ${new Date(state.next_energy_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : t('fullEnergy')}
          </span>
        </div>
        <div className="stat-card">
          <Coins size={22} />
          <small>{t('gold')}</small>
          <strong>{state.gold_balance.toLocaleString()}</strong>
          <span>{t('balance')}</span>
        </div>
        <div className="stat-card">
          <Sprout size={22} />
          <small>{t('production')}</small>
          <strong>{Object.values(state.production).reduce((a, b) => a + b, 0)}</strong>
          <span>{t('perTurn')}</span>
        </div>
      </div>
      <div className="account-grid">
        <section className="panel">
          <h2>
            {t('myLand')}
            <span className="count-pill">{state.territory_count}</span>
          </h2>
          <div className="land-list">
            {state.territories.map((tile) => (
              <Link key={tile.id} className="land-row" to={`/territory/${tile.id}`}>
                <span className={`land-icon ${tile.terrain_type}`}>
                  {tile.terrain_type === 'forest' ? <Leaf size={22} /> : <Flag size={22} />}
                </span>
                <div>
                  <strong>{t(tile.terrain_type)}</strong>
                  <small>
                    {t(tile.region_id as TextKey)} · {tile.x}, {tile.y}
                    {tile.structure_type ? ` · ${t(tile.structure_type as TextKey)}` : ''}
                  </small>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>{t('inventory')}</h2>
          {RESOURCE_KINDS.map((kind) => (
            <div className="inventory-row" key={kind}>
              <Resource kind={kind} />
              <strong>{state.resources[kind]}</strong>
              <small>+{state.production[kind]} / 6h</small>
            </div>
          ))}
          <Link to="/market" className="button secondary full">
            {t('market')}
            <ArrowRight size={16} />
          </Link>
        </section>
        <section className="panel">
          <h2>{t('history')}</h2>
          {transactions?.gold.length ? (
            transactions.gold.map((entry, i) => (
              <div className="history-row" key={i}>
                <span>
                  <strong>{t(`${entry.reason}Reason` as TextKey)}</strong>
                  <small>{new Date(entry.created_at * 1000).toLocaleString()}</small>
                </span>
                <span className={entry.delta > 0 ? 'positive' : ''}>
                  {entry.delta > 0 ? '+' : ''}
                  {entry.delta} Gold
                </span>
              </div>
            ))
          ) : (
            <p>{t('noHistory')}</p>
          )}
          {transactions && (
            <details>
              <summary>
                {t('inventory')} · {t('history')}
              </summary>
              {transactions.resources.map((entry, i) => (
                <div className="history-row" key={i}>
                  <span>{t(`${entry.reason}Reason` as TextKey)}</span>
                  <span>
                    {entry.delta > 0 ? '+' : ''}
                    {entry.delta} {t(entry.kind!)}
                  </span>
                </div>
              ))}
            </details>
          )}
        </section>
        <section className="panel">
          <h2>{t('achievements')}</h2>
          {milestones.map(([key, done]) => (
            <div className={`milestone ${done ? 'complete' : ''}`} key={key}>
              <span>
                <Trophy size={20} />
              </span>
              <div>
                <strong>{t(key)}</strong>
                <small>{t(done ? 'achieved' : 'locked')}</small>
              </div>
              {done && <Check size={16} />}
            </div>
          ))}
          {transactions?.history && (
            <details>
              <summary>{t('seasonalHistory')}</summary>
              {transactions.history.map((h) => (
                <p key={h.season_id}>
                  {h.season_id} · {h.territory_count} {t('land')} · {h.produced_total} {t('grown')}
                </p>
              ))}
            </details>
          )}
        </section>
        <section className="panel profile-panel">
          <h2>{t('profile')}</h2>
          <form onSubmit={(e) => void save(e)}>
            <label>
              {t('displayName')}
              <input
                value={name}
                minLength={2}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label>
              {t('flag')}
              <select value={flag} onChange={(e) => setFlag(e.target.value)}>
                {['fern', 'ocean', 'sunset'].map((f) => (
                  <option value={f} key={f}>
                    {t(f as TextKey)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary" disabled={busy}>
              {t('save')}
            </button>
            <button
              type="button"
              className="subtle-button"
              onClick={async () => {
                try {
                  await post('/auth/logout', {});
                  await refresh();
                } catch (e) {
                  fail(e);
                }
              }}
            >
              {t('signOut')}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
export function MarketPage() {
  const { t, config, state, user, setAuthOpen, refresh, notify, fail } = useWorld();
  const [kind, setKind] = useState<ResourceKind | 'all'>('all'),
    [search, setSearch] = useState(''),
    [selling, setSelling] = useState(false),
    [buying, setBuying] = useState<Order | null>(null),
    [busy, setBusy] = useState(false);
  const [saleKind, setSaleKind] = useState<ResourceKind>('food'),
    [quantity, setQuantity] = useState(1),
    [price, setPrice] = useState(2),
    [offset, setOffset] = useState(0),
    [extra, setExtra] = useState<Order[]>([]);
  const { data, error, loading, load } = useData<{ orders: Order[]; next_offset: number | null }>(
    `/market/orders?kind=${kind}`,
  );
  useEffect(() => {
    setExtra([]);
    setOffset(0);
  }, [kind]);
  const orders = [...(data?.orders || []), ...extra].filter((order) =>
    `${order.seller_name} ${t(order.kind)}`.toLowerCase().includes(search.toLowerCase()),
  );
  const action = async (path: string, payload: Record<string, unknown>, success: TextKey) => {
    setBusy(true);
    try {
      await mutate(path, payload);
      setSelling(false);
      setBuying(null);
      setExtra([]);
      setOffset(0);
      await refresh();
      await load();
      notify(success);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (!config?.flags.market)
    return (
      <main className="page">
        <Empty title={t('marketOff')} />
      </main>
    );
  return (
    <main className="page">
      <PageHeading eyebrow={t('marketEyebrow')} title={t('marketTitle')} body={t('marketBody')}>
        <button
          className="button primary"
          onClick={() => (state ? setSelling(true) : setAuthOpen(true))}
        >
          <Plus size={17} />
          {t('sell')}
        </button>
      </PageHeading>
      <div className="market-tools">
        <div className="filter-tabs">
          {(['all', ...RESOURCE_KINDS] as const).map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {k !== 'all' && <Resource kind={k} />} {k === 'all' ? t('all') : null}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <p className="market-note">
        <Shield size={15} />
        {t('taxNote')}
      </p>
      {error ? (
        <Empty title={error}>
          <button className="button secondary" onClick={() => void load()}>
            {t('retry')}
          </button>
        </Empty>
      ) : loading && !data ? (
        <p className="loading-inline">{t('loading')}</p>
      ) : orders.length ? (
        <div className="order-grid">
          {orders.map((order) => {
            const Icon = resourceIcon[order.kind],
              own = order.seller_user_id === user?.id;
            return (
              <article className="order-card" key={order.id}>
                <div className="order-card-top">
                  <span className={`order-resource ${order.kind}`}>
                    <Icon size={29} strokeWidth={1.4} />
                  </span>
                  <span className="pill">{own ? t('yourOffer') : t(order.kind)}</span>
                </div>
                <h2>
                  {order.quantity} <span>{t(order.kind)}</span>
                </h2>
                <p className="seller-name">
                  {order.seller_name}
                  {Boolean(order.is_test) && <span className="test-label">{t('testAccount')}</span>}
                </p>
                <div className="order-price">
                  <span>
                    {order.price_gold} Gold<small> / 1 {t(order.kind)}</small>
                  </span>
                  <strong>
                    {order.price_gold * order.quantity}
                    <Coins size={15} />
                  </strong>
                </div>
                <button
                  className={`button ${own ? 'secondary' : 'primary'} full`}
                  disabled={busy}
                  onClick={() => {
                    if (!state) {
                      setAuthOpen(true);
                      return;
                    }
                    if (own) void action(`/market/orders/${order.id}/cancel`, {}, 'cancelSuccess');
                    else setBuying(order);
                  }}
                >
                  {t(own ? 'withdraw' : 'buy')}
                  {!own && <ArrowRight size={16} />}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty title={t('emptyMarket')} body={t('emptyMarketBody')}>
          <ShoppingBasket size={26} strokeWidth={1} />
        </Empty>
      )}
      {data?.next_offset !== null && data?.next_offset !== undefined && offset !== -1 && (
        <button
          className="button secondary load-more"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const next = await api<{ orders: Order[]; next_offset: number | null }>(
                `/market/orders?kind=${kind}&offset=${offset || data.next_offset}`,
              );
              setExtra((v) => [...v, ...next.orders]);
              setOffset(next.next_offset ?? -1);
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('more')}
        </button>
      )}
      {selling && (
        <Modal title={t('sell')} onClose={() => setSelling(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(
                '/market/orders',
                { kind: saleKind, quantity, price_gold: price },
                'orderSuccess',
              );
            }}
          >
            <label>
              {t('inventory')}
              <select
                value={saleKind}
                onChange={(e) => setSaleKind(e.target.value as ResourceKind)}
              >
                {RESOURCE_KINDS.map((k) => (
                  <option value={k} key={k}>
                    {t(k)} ({state?.resources[k] || 0})
                  </option>
                ))}
              </select>
            </label>
            <div className="form-columns">
              <label>
                {t('quantity')}
                <input
                  type="number"
                  min={1}
                  max={Math.min(10000, state?.resources[saleKind] || 1)}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                />
              </label>
              <label>
                {t('unitPrice')}
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  required
                />
              </label>
            </div>
            <div className="form-total">
              {t('total')}
              <strong>{quantity * price} Gold</strong>
            </div>
            <p className="fine-print">
              {t('taxBurned')}: {tradeTax(quantity * price)} Gold
            </p>
            <button className="button primary full" disabled={busy}>
              {t('sell')}
            </button>
          </form>
        </Modal>
      )}
      {buying && (
        <Modal title={t('buy')} onClose={() => setBuying(null)}>
          <p>
            {t('confirmBuy', {
              quantity: buying.quantity,
              kind: t(buying.kind),
              total: buying.quantity * buying.price_gold,
            })}
          </p>
          <button
            className="button primary full"
            disabled={busy}
            onClick={() => void action(`/market/orders/${buying.id}/buy`, {}, 'buySuccess')}
          >
            {t('confirm')}
          </button>
        </Modal>
      )}
    </main>
  );
}
export function LeaderboardPage() {
  const { t, config } = useWorld();
  const [season, setSeason] = useState(config?.season.id || 's1');
  const { data, error, loading, load } = useData<{ rows: Rank[]; generated_at: number }>(
    `/leaderboards?season=${season}`,
  );
  const { data: seasons } = useData<{ seasons: { id: string }[] }>('/seasons');
  return (
    <main className="page">
      <PageHeading eyebrow={t('rankEyebrow')} title={t('rankTitle')} body={t('rankBody')}>
        <label className="season-picker">
          {t('season')}
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            {(seasons?.seasons || [{ id: season }]).map((s) => (
              <option key={s.id}>{s.id}</option>
            ))}
          </select>
        </label>
      </PageHeading>
      {error ? (
        <Empty title={error}>
          <button className="button secondary" onClick={() => void load()}>
            {t('retry')}
          </button>
        </Empty>
      ) : loading && !data ? (
        <p>{t('loading')}</p>
      ) : data?.rows.length ? (
        <div className="ranking-panel">
          <div className="ranking-head">
            <span>{t('rank')}</span>
            <span>{t('seller')}</span>
            <span>{t('land')}</span>
            <span>{t('grown')}</span>
            <span>{t('score')}</span>
          </div>
          {data.rows.map((row, i) => (
            <div className={`ranking-row ${i < 3 ? 'top-rank' : ''}`} key={row.user_id}>
              <span className="rank-number">
                {i < 3 ? <Trophy size={19} /> : String(i + 1).padStart(2, '0')}
                <small>{i < 3 ? i + 1 : ''}</small>
              </span>
              <span className="rank-name">
                <span className="avatar">{row.display_name.slice(0, 1)}</span>
                <strong>{row.display_name}</strong>
                {Boolean(row.is_test) && <span className="test-label">{t('testAccount')}</span>}
              </span>
              <span>{row.territory_count}</span>
              <span>{row.produced_total}</span>
              <strong>{row.score}</strong>
            </div>
          ))}
        </div>
      ) : (
        <Empty title={t('noRanks')} />
      )}
      <p className="fine-print ranking-note">
        <Clock size={14} />
        {t('hourly')}{' '}
        {data && `${t('updated')}: ${new Date(data.generated_at * 1000).toLocaleString()}`}
      </p>
    </main>
  );
}
export function StorePage() {
  const { t } = useWorld();
  const [preview, setPreview] = useState('fern');
  const { data, error, load } = useData<{
    packs: { sku: string; usd_cents: number; gems: number }[];
  }>('/store/catalog');
  return (
    <main className="page">
      <PageHeading eyebrow={t('studioEyebrow')} title={t('studioTitle')} body={t('studioBody')} />
      <div className="store-notice">
        <Sparkles size={17} />
        {t('previewOnly')}
      </div>
      <div className="studio-layout">
        <div className={`flag-preview ${preview}`}>
          <div className="flag-pole" />
          <div className="flag-cloth">
            <GlobeIcon />
          </div>
          <div className="flag-ground" />
          <span>{t(preview as TextKey)}</span>
        </div>
        <section className="studio-copy">
          <span className="eyebrow">{t('preview')}</span>
          <h2>{t('flag')}</h2>
          <p>{t('noPayments')}</p>
          <div className="swatches">
            {['fern', 'ocean', 'sunset'].map((f) => (
              <button
                key={f}
                className={`swatch ${f} ${preview === f ? 'active' : ''}`}
                aria-label={t(f as TextKey)}
                aria-pressed={preview === f}
                onClick={() => setPreview(f)}
              >
                {preview === f && <Check size={18} />}
              </button>
            ))}
          </div>
        </section>
      </div>
      {error ? (
        <Empty title={error}>
          <button className="button secondary" onClick={() => void load()}>
            {t('retry')}
          </button>
        </Empty>
      ) : (
        <div className="pack-grid">
          {data?.packs.map((pack, i) => (
            <article className="pack-card" key={pack.sku}>
              <span className="eyebrow">
                0{i + 1} / {t('proposedPrice')}
              </span>
              <h2>{t((pack.sku === 'builder' ? 'builderPack' : pack.sku) as TextKey)}</h2>
              <p>
                <Sparkles size={22} />
                <strong>{pack.gems.toLocaleString()}</strong> Gems
              </p>
              <div>
                <span>${pack.usd_cents / 100} USD</span>
                <button className="button secondary small" disabled>
                  {t('preview')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
function GlobeIcon() {
  return (
    <span className="flag-emblem">
      <Leaf size={46} strokeWidth={1.2} />
    </span>
  );
}
export function RulesPage() {
  const { t } = useWorld();
  const sections = ['Explore', 'Claim', 'Produce', 'Trade', 'Season', 'Fair'] as const;
  return (
    <main className="page rules-page">
      <PageHeading eyebrow={t('rulesEyebrow')} title={t('rulesTitle')} body={t('rulesIntro')} />
      <div className="rules-grid">
        {sections.map((name, i) => (
          <section className="rule-card" key={name}>
            <span className="rule-number">0{i + 1}</span>
            <h2>{t(`rule${name}`)}</h2>
            <p>{t(`rule${name}Body`)}</p>
          </section>
        ))}
      </div>
      <p className="release-note">
        <Shield size={18} />
        {t('releaseNote')}
      </p>
    </main>
  );
}
type AdminData = {
  metrics: {
    day: string;
    route: string;
    requests: number;
    errors: number;
    rows_read: number;
    rows_written: number;
    cache_hits: number;
  }[];
  users: { is_test: number; count: number }[];
  economy: { gold_supply: number; tax_burned: number; escrow: number };
  reports: { id: string; reason: string; target_id: string; reporter_name: string }[];
  retention: {
    is_test: number;
    cohort: number;
    d1_returned: number;
    d7_eligible: number;
    d7_returned: number;
  }[];
  engagement: { is_test: number; weekly_active: number; claims: number; trades: number }[];
};
export function AdminPage() {
  const { t, user } = useWorld();
  if (user?.role !== 'admin')
    return (
      <main className="page">
        <Empty title={t('forbidden')} />
      </main>
    );
  return <AdminContents />;
}
function AdminContents() {
  const { t, fail } = useWorld();
  const { data, error, load } = useData<AdminData>('/admin/metrics');
  if (error)
    return (
      <main className="page">
        <Empty title={error}>
          <button className="button secondary" onClick={() => void load()}>
            {t('retry')}
          </button>
        </Empty>
      </main>
    );
  if (!data) return <main className="page">{t('loading')}</main>;
  const sums = data.metrics.reduce(
    (a, r) => ({
      requests: a.requests + r.requests,
      cache: a.cache + r.cache_hits,
      read: a.read + r.rows_read,
      write: a.write + r.rows_written,
    }),
    { requests: 0, cache: 0, read: 0, write: 0 },
  );
  return (
    <main className="page">
      <PageHeading eyebrow="WORLD" title={t('operations')} body={t('opsBody')} />
      <div className="stat-grid">
        {[
          ['requests', sums.requests],
          ['cacheHits', `${sums.cache} / ${sums.requests}`],
          ['rowsRead', sums.read],
          ['rowsWritten', sums.write],
        ].map(([key, value]) => (
          <div className="stat-card" key={key}>
            <small>{t(key as TextKey)}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="account-grid">
        <section className="panel">
          <h2>{t('inventory')}</h2>
          <p>
            {t('gold')}: {data.economy.gold_supply}
          </p>
          <p>
            {t('taxBurned')}: {data.economy.tax_burned}
          </p>
          <p>
            {t('escrow')}: {data.economy.escrow}
          </p>
          {data.users.map((u) => (
            <p key={u.is_test}>
              {t(u.is_test ? 'testPlayers' : 'realPlayers')}: {u.count}
            </p>
          ))}
        </section>
        <section className="panel">
          <h2>{t('retention')}</h2>
          {data.retention.map((r) => (
            <div key={r.is_test}>
              <h3>{t(r.is_test ? 'testPlayers' : 'realPlayers')}</h3>
              <p>
                {t('d1')}: {r.d1_returned} / {r.cohort}
              </p>
              <p>
                {t('d7')}: {r.d7_returned} / {r.d7_eligible}
              </p>
            </div>
          ))}
          <h3>{t('engagement')}</h3>
          {data.engagement.map((e) => (
            <p key={e.is_test}>
              {t(e.is_test ? 'testPlayers' : 'realPlayers')}: {e.weekly_active} · {t('claim')}:{' '}
              {e.claims} · {t('buy')}: {e.trades}
            </p>
          ))}
        </section>
      </div>
      <section className="panel">
        <h2>{t('reports')}</h2>
        {data.reports.length ? (
          data.reports.map((r) => (
            <div className="report-row" key={r.id}>
              <strong>{r.reporter_name}</strong>
              <code>{r.target_id}</code>
              <p>{r.reason}</p>
              <button
                className="button secondary small"
                onClick={async () => {
                  try {
                    await post(`/admin/reports/${r.id}`, { status: 'resolved' });
                    await load();
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                {t('resolve')}
              </button>
            </div>
          ))
        ) : (
          <p>{t('noReports')}</p>
        )}
      </section>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>UTC</th>
              <th>API</th>
              <th>{t('requests')}</th>
              <th>{t('rowsRead')}</th>
              <th>{t('rowsWritten')}</th>
            </tr>
          </thead>
          <tbody>
            {data.metrics.map((r) => (
              <tr key={`${r.day}:${r.route}`}>
                <td>{r.day}</td>
                <td>{r.route}</td>
                <td>{r.requests}</td>
                <td>{r.rows_read}</td>
                <td>{r.rows_written}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
