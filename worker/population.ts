import { plotPrice, type Territory } from '../shared/game';
import type { Db } from './db';

export async function withPopulation(db: Db, tile: Territory): Promise<Territory> {
  const data = await db.first<{
    population: number;
    population_year: number;
    population_source: string;
  }>(
    'SELECT population,year AS population_year,source AS population_source FROM territory_population WHERE territory_id=?',
    tile.id,
  );
  // The market price includes demand from recent trades (migration 0017); a plot without a row yet
  // falls back to its base value.
  const market = await db.first<{ market_price: number }>(
    'SELECT market_price FROM land_market WHERE territory_id=?',
    tile.id,
  );
  return { ...tile, ...data, price_gold: market?.market_price ?? plotPrice(data?.population) };
}
