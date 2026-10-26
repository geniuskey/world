import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { api, ApiFailure, post } from './api';
import { worldTileName, worldTileFromId } from '../shared/worldGrid';
import { en, ko, type TextKey } from './i18n';
import {
  POLL_MS,
  type WorldConfig,
  type Region,
  type Player,
  type PlayerState,
} from '../shared/game';

function useWorldState() {
  const [locale, setLocaleState] = useState<'en' | 'ko'>(() =>
    localStorage.getItem('world:locale') === 'ko' ? 'ko' : 'en',
  );
  const [config, setConfig] = useState<WorldConfig | null>(null),
    [regions, setRegions] = useState<Region[]>([]);
  const [user, setUser] = useState<Player | null>(null),
    [state, setState] = useState<PlayerState | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [authOpen, setAuthOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const t = useCallback(
    (key: TextKey, values: Record<string, string | number> = {}) => {
      const tile = worldTileFromId(key);
      let text: string =
        (locale === 'ko' ? ko : en)[key] ??
        (tile ? worldTileName(tile, locale) : undefined) ??
        regions.find((r) => r.id === key)?.name ??
        key;
      for (const [k, v] of Object.entries(values)) text = text.replaceAll(`{${k}}`, String(v));
      return text;
    },
    [locale, regions],
  );
  const message = useCallback(
    (e: unknown) => {
      const key = `error_${e instanceof ApiFailure ? e.code : ''}` as TextKey;
      return key in en ? t(key) : t('connectionError');
    },
    [t],
  );
  const setLocale = (value: 'en' | 'ko') => {
    setLocaleState(value);
    localStorage.setItem('world:locale', value);
  };
  const refresh = useCallback(async (fresh = true) => {
    try {
      const result = await api<PlayerState>('/me/state', { fresh });
      setState(result);
      setUser(result.user);
      setConfig((current) => (current ? { ...current, season: result.season } : current));
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) {
        setState(null);
        setUser(null);
      } else if (e instanceof ApiFailure && e.code === 'NOT_JOINED') setState(null);
      else throw e;
    }
    const r = await api<{ regions: Region[] }>('/regions', { fresh });
    setRegions(r.regions);
    setRevision((v) => v + 1);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, r, me] = await Promise.all([
        api<WorldConfig>('/world/config'),
        api<{ regions: Region[] }>('/regions'),
        api<{ user: Player }>('/me').catch((e) => {
          if (e instanceof ApiFailure && e.status === 401) return null;
          throw e;
        }),
      ]);
      setConfig(cfg);
      setRegions(r.regions);
      setUser(me?.user || null);
      if (me) {
        await refresh(false);
        void post('/events', { event: 'visit' }).catch(() => {});
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [message, refresh]);
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible')
        void refresh(false).catch((e) => setToast(message(e)));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, message]);
  const notify = (key: TextKey) => setToast(t(key));
  const fail = (e: unknown) => setToast(message(e));
  return {
    locale,
    setLocale,
    t,
    message,
    config,
    regions,
    user,
    state,
    loading,
    error,
    load,
    refresh,
    authOpen,
    setAuthOpen,
    toast,
    setToast,
    notify,
    fail,
    revision,
  };
}
const WorldContext = createContext<ReturnType<typeof useWorldState> | null>(null);
export function WorldProvider({ children }: { children: ReactNode }) {
  const value = useWorldState();
  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>;
}
export function useWorld() {
  return useContext(WorldContext)!;
}
