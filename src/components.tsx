import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Globe2,
  ArrowUpRight,
  ArrowRight,
  X,
  Zap,
  Coins,
  Wheat,
  TreePine,
  Mountain,
  Menu,
  Check,
  Sprout,
  Flag,
} from 'lucide-react';
import { useWorld } from './state';
import { api, post } from './api';
import type { TextKey } from './i18n';
import { worldTileFromId, regionForTile } from '../shared/worldGrid';
import type { ResourceKind } from '../shared/game';

export const resourceIcon = { food: Wheat, wood: TreePine, iron: Mountain };
export function Resource({
  kind,
  amount,
}: {
  kind: ResourceKind | 'gold' | 'energy';
  amount?: number;
}) {
  const { t } = useWorld();
  const Icon = kind === 'gold' ? Coins : kind === 'energy' ? Zap : resourceIcon[kind];
  return (
    <span className={`resource ${kind}`}>
      <Icon size={16} />
      <span>{amount === undefined ? t(kind) : amount.toLocaleString()}</span>
    </span>
  );
}
export function Header() {
  const { t, locale, setLocale, user, state, setAuthOpen, config } = useWorld();
  const [menu, setMenu] = useState(false);
  const links = [
    ['/', 'world'],
    ['/me', 'territory'],
    ['/market', 'market'],
    ['/leaderboard', 'leaderboard'],
    ['/store', 'store'],
  ] as const;
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="WORLD">
          <Globe2 size={29} strokeWidth={1.4} />
          <span>
            WORLD<span className="brand-dot">.</span>
          </span>
        </Link>
        <nav className={menu ? 'main-nav open' : 'main-nav'} aria-label={t('world')}>
          {links.map(([path, key]) => (
            <NavLink key={path} to={path} end={path === '/'} onClick={() => setMenu(false)}>
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="locale-button"
            onClick={() => setLocale(locale === 'en' ? 'ko' : 'en')}
            aria-label={locale === 'en' ? '한국어로 변경' : 'Switch to English'}
          >
            {locale === 'en' ? 'KO' : 'EN'}
          </button>
          {user ? (
            <Link to="/me" className="account-button">
              <span className={`avatar ${user.flag_style}`}>{user.display_name.slice(0, 1)}</span>
              <span className="account-name">{user.display_name}</span>
            </Link>
          ) : (
            <button className="button primary small" onClick={() => setAuthOpen(true)}>
              {t('signIn')}
              <ArrowUpRight size={15} />
            </button>
          )}
          <button
            className="icon-button menu-button"
            aria-label="Menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={21} />
          </button>
        </div>
      </header>
      <div className="seasonbar">
        <div>
          <span className="status-dot" />
          <span>
            {t('season')} {config?.season.id.replace('s', '') || '1'}
          </span>
          <span className="season-divider">/</span>
          <strong>{t('seasonName')}</strong>
        </div>
        {state ? (
          <div className="quick-resources">
            <Resource kind="energy" amount={state.energy_value} />
            <span className="cap">/ 4</span>
            <Resource kind="gold" amount={state.gold_balance} />
            <Resource kind="food" amount={state.resources.food} />
            <Resource kind="wood" amount={state.resources.wood} />
            <Resource kind="iron" amount={state.resources.iron} />
          </div>
        ) : (
          <span className="season-days">
            {config &&
              t('daysLeft', {
                days: Math.max(0, Math.ceil((config.season.ends_at - Date.now() / 1000) / 86400)),
              })}
          </span>
        )}
      </div>
    </>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const nodes = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex="0"]',
        ) || [],
      );
    (
      dialog.current?.querySelector<HTMLElement>('input:not([type="checkbox"]),select,textarea') ||
      nodes()[0]
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const list = nodes(),
          first = list[0],
          last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <span className="modal-mark">
          <Sprout size={26} />
        </span>
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function AuthModal() {
  const { t, locale, config, refresh, setAuthOpen, user, message } = useWorld();
  const navigate = useNavigate();
  const location = useLocation();
  const region = decodeURIComponent(location.pathname.match(/^\/region\/(.+)$/)?.[1] || '');
  const [name, setName] = useState(''),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const close = () => setAuthOpen(false);
  const submit = async (e: FormEvent, provider: 'dev' | 'google' = 'dev') => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (user) await post('/join', { region_id: region, accept_rules: accepted });
      else if (provider === 'google') {
        const result = await post<{ url: string }>('/auth/google', {
          display_name: name,
          region_id: region,
          locale,
          accept_rules: accepted,
        });
        window.location.assign(result.url);
        return;
      } else
        await post('/auth/dev', {
          display_name: name,
          region_id: region,
          locale,
          accept_rules: accepted,
        });
      await refresh();
      void post('/events', { event: 'visit' }).catch(() => {});
      const settled = await api<{ territories: { region_id: string }[] }>('/me/state', {
        fresh: true,
      });
      close();
      navigate(`/region/${settled.territories[0]?.region_id || region}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  if (!worldTileFromId(region))
    return (
      <Modal title={t('chooseOnMap')} onClose={close}>
        <p>{t('chooseOnMapBody')}</p>
        <button
          className="button primary full"
          onClick={() => {
            close();
            navigate('/');
          }}
        >
          {t('chooseOnMap')}
        </button>
      </Modal>
    );
  return (
    <Modal title={t('welcome')} onClose={close}>
      <p>{t('welcomeBody')}</p>
      <form onSubmit={(e) => void submit(e, config?.auth.google ? 'google' : 'dev')}>
        {!user && (
          <label>
            {t('displayName')}
            <input
              name="display_name"
              autoComplete="nickname"
              minLength={2}
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              required
            />
          </label>
        )}
        <label>
          {t('startRegion')}
          <input readOnly value={regionForTile(worldTileFromId(region)!, '').name} />
          <input type="hidden" name="region_id" value={region} />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            required
          />
          <span>
            {t('acceptRules')}{' '}
            <Link to="/rules" onClick={close}>
              {t('rules')} ↗
            </Link>
          </span>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {user || config?.auth.google || config?.auth.dev ? (
          <button className="button primary full" disabled={busy || !accepted}>
            {busy
              ? t('loading')
              : user
                ? t('joinSeason')
                : config?.auth.google
                  ? t('google')
                  : t('devLogin')}
            <ArrowRight size={17} />
          </button>
        ) : (
          <p className="notice">{t('authUnavailable')}</p>
        )}
        {config?.auth.dev && !user && <p className="fine-print">{t('devNote')}</p>}
      </form>
    </Modal>
  );
}
export function PageHeading({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{body}</p>
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Flag size={28} strokeWidth={1.3} />
      </span>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}
export function Footer() {
  const { t, user } = useWorld();
  return (
    <footer className="footer">
      <span>
        <Globe2 size={15} /> {t('footer')}
      </span>
      <div>
        <Link to="/rules">{t('rules')}</Link>
        {user?.role === 'admin' && <Link to="/admin">{t('admin')}</Link>}
        <span>© WORLD</span>
      </div>
    </footer>
  );
}
export function Toast() {
  const { toast, setToast } = useWorld();
  return toast ? (
    <div className="toast" role="status">
      <Check size={18} />
      <span>{toast}</span>
      <button className="icon-button" aria-label="Close" onClick={() => setToast(null)}>
        <X size={16} />
      </button>
    </div>
  ) : null;
}
