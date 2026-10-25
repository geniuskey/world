export const TURN_SECONDS = 21_600;
export const MAX_ENERGY = 4;
export const CHUNK_SIZE = 8;
export const POLL_MS = 120_000;
export const RESOURCE_KINDS = ['food', 'wood', 'iron'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type Terrain = 'meadow' | 'forest' | 'mountain' | 'water';
export const terrainResource: Record<Exclude<Terrain, 'water'>, ResourceKind> = {
  meadow: 'food',
  forest: 'wood',
  mountain: 'iron',
};
export const facilityFor = { meadow: 'farm', forest: 'lumberyard', mountain: 'mine' } as const;
export type Season = {
  id: string;
  begins_at: number;
  ends_at: number;
  status: string;
  rules_version: string;
};
export type Region = {
  id: string;
  name: string;
  subtitle: string;
  longitude: number;
  latitude: number;
  width: number;
  height: number;
  season_id: string;
  map_version: number;
  owned: number;
  available: number;
};
export type Territory = {
  id: string;
  region_id: string;
  season_id: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  terrain_type: Terrain;
  owner_user_id: string | null;
  owner_name?: string | null;
  acquired_at: number | null;
  version: number;
  structure_type: string | null;
  is_starter: number;
};
export type Player = {
  id: string;
  display_name: string;
  locale: 'en' | 'ko';
  flag_style: string;
  role: 'player' | 'admin';
  is_test: number;
};
export type PlayerState = {
  user: Player;
  season: Season;
  energy_value: number;
  energy_updated_at: number;
  gold_balance: number;
  territory_count: number;
  produced_total: number;
  resources: Record<ResourceKind, number>;
  territories: Territory[];
  production: Record<ResourceKind, number>;
  next_energy_at: number | null;
  achievements: { kind: string; earned_at: number; season_id: string }[];
};
export type Order = {
  id: string;
  seller_user_id: string;
  seller_name: string;
  kind: ResourceKind;
  quantity: number;
  price_gold: number;
  status: string;
  created_at: number;
  is_test: number;
};
export type Rank = {
  user_id: string;
  display_name: string;
  territory_count: number;
  produced_total: number;
  production_rate: number;
  score: number;
  is_test: number;
};
export type WorldConfig = {
  season: Season;
  server_time: number;
  turn_seconds: number;
  chunk_size: number;
  flags: { market: boolean; combat: boolean; payments: boolean; land_trading: boolean };
  auth: { google: boolean; dev: boolean };
};
export type CommandResult = {
  action_id: string;
  result: Record<string, string | number>;
  replayed: boolean;
};

export function recoverEnergy(value: number, updatedAt: number, now: number) {
  const turns = Math.max(0, Math.floor((now - updatedAt) / TURN_SECONDS));
  const energy = Math.min(MAX_ENERGY, value + turns);
  return {
    value: energy,
    updatedAt: energy === MAX_ENERGY ? now : updatedAt + turns * TURN_SECONDS,
  };
}
export const tradeTax = (total: number) => Math.ceil((total * 3) / 100);
