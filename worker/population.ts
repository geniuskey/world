import type { Territory } from '../shared/game';
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
  return { ...tile, ...data };
}
