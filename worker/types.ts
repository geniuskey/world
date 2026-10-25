import type { Context } from 'hono';
import type { Player } from '../shared/game';
import type { Db } from './db';
export type Env = {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_ORIGIN: string;
  DEV_AUTH_ENABLED: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET?: string;
  MARKET_ENABLED: string;
  WORLD_AUTO_SPLIT_ENABLED?: string;
  COMBAT_ENABLED: string;
  PAYMENTS_ENABLED: string;
  LAND_TRADING_ENABLED: string;
};
export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; user: Player; now: number; cacheHit: boolean };
};
export type Ctx = Context<AppEnv>;
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
