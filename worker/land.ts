import type { Db } from './db';
import { ApiError } from './types';
import { parseTerritoryId, plotPoint, plotRegionFromId } from '../shared/plots';
import {
  chunkValue,
  placeCell,
  placeDatasetAt,
  placeFromIndex,
  placeName,
  type PlaceChunk,
  type PlaceIndex,
} from '../shared/places';

// Every recorded event on a plot: settlement, claims, facilities and changes of hands.
// Buy actions carry the plot in result_json, so one index lookup covers all of them.
export async function landHistory(db: Db, season: string, territory: string) {
  const events = await db.all<{
    type: string;
    user_id: string;
    display_name: string | null;
    created_at: number;
    kind: string | null;
    price_gold: number | null;
    seller_user_id: string | null;
    seller_name: string | null;
  }>(
    `SELECT a.type,a.user_id,CASE WHEN u.status='active' THEN p.display_name END AS display_name,a.created_at,
    l.kind,COALESCE(l.price_gold,json_extract(a.result_json,'$.price_gold')) AS price_gold,
    l.seller_user_id,CASE WHEN su.status='active' THEN sp.display_name END AS seller_name
    FROM actions a JOIN users u ON u.id=a.user_id JOIN profiles p ON p.user_id=a.user_id
    LEFT JOIN land_trades l ON l.id=a.id LEFT JOIN users su ON su.id=l.seller_user_id LEFT JOIN profiles sp ON sp.user_id=l.seller_user_id
    WHERE a.season_id=? AND json_extract(a.result_json,'$.territory_id')=? AND a.type IN ('join','claim','build','buy')
    ORDER BY a.created_at,a.rowid LIMIT 200`,
    season,
    territory,
  );
  const first = events.find((e) => e.type === 'join' || e.type === 'claim');
  return {
    first: first
      ? { user_id: first.user_id, display_name: first.display_name, at: first.created_at }
      : null,
    events: events.slice(-20).reverse(),
  };
}

export async function playerProfile(db: Db, season: string, user: string) {
  const profile = await db.first<{
    id: string;
    display_name: string;
    flag_style: string;
    created_at: number;
    is_test: number;
  }>(
    "SELECT u.id,p.display_name,p.flag_style,u.created_at,u.is_test FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND u.status='active'",
    user,
  );
  if (!profile) throw new ApiError('NOT_FOUND', 404);
  const [state, settled, plots, trades] = await Promise.all([
    db.first<{ territory_count: number; produced_total: number }>(
      'SELECT territory_count,produced_total FROM player_state WHERE user_id=? AND season_id=?',
      user,
      season,
    ),
    // Plots never return to the commons, so every join or claim was a first settlement.
    db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM actions WHERE user_id=? AND season_id=? AND type IN ('join','claim')",
      user,
      season,
    ),
    db.all(
      'SELECT id,region_id,x,y,gx,gy,terrain_type,structure_type,acquired_at FROM territories WHERE owner_user_id=? AND season_id=? ORDER BY acquired_at,id LIMIT 100',
      user,
      season,
    ),
    landTrades(db, season, user, 0, 20),
  ]);
  return {
    player: {
      ...profile,
      territory_count: state?.territory_count ?? 0,
      produced_total: state?.produced_total ?? 0,
      first_settled: settled?.n ?? 0,
    },
    plots,
    trades,
  };
}

// Trades the user took part in after `since`, newest first, with the other party's name.
export function landTrades(db: Db, season: string, user: string, since: number, limit: number) {
  return db.all<{
    id: string;
    territory_id: string;
    kind: string;
    price_gold: number;
    tax_gold: number;
    created_at: number;
    sold: number;
    other_user_id: string;
    other_name: string | null;
  }>(
    `SELECT l.id,l.territory_id,l.kind,l.price_gold,l.tax_gold,l.created_at,l.seller_user_id=? AS sold,
    CASE WHEN l.seller_user_id=? THEN l.buyer_user_id ELSE l.seller_user_id END AS other_user_id,
    CASE WHEN u.status='active' THEN p.display_name END AS other_name
    FROM land_trades l JOIN users u ON u.id=CASE WHEN l.seller_user_id=? THEN l.buyer_user_id ELSE l.seller_user_id END
    JOIN profiles p ON p.user_id=u.id
    WHERE l.season_id=? AND (l.seller_user_id=? OR l.buyer_user_id=?) AND l.created_at>?
    ORDER BY l.created_at DESC,l.id LIMIT ?`,
    user,
    user,
    user,
    season,
    user,
    user,
    since,
    limit,
  );
}

// Land the user sold or lost since they last dismissed these notices.
export async function landNotices(db: Db, season: string, user: string) {
  const seen = await db.first<{ land_seen_at: number }>(
    'SELECT land_seen_at FROM profiles WHERE user_id=?',
    user,
  );
  const trades = await landTrades(db, season, user, seen?.land_seen_at ?? 0, 20);
  return trades.filter((trade) => trade.sold);
}

async function assetJson<T>(assets: Fetcher, origin: string, path: string) {
  const response = await assets.fetch(new URL(path, origin));
  return response.ok ? ((await response.json()) as T) : null;
}
// Link previews: the plot's real place name and owner, for share cards.
export async function shareMeta(
  db: Db,
  territory: string,
  locale: string,
  assets?: Fetcher,
  origin = 'https://world.invalid',
) {
  const parsed = parseTerritoryId(territory);
  const region = parsed && plotRegionFromId(parsed.region);
  if (!parsed) return null;
  const owner = await db.first<{ display_name: string }>(
    "SELECT p.display_name FROM territories t JOIN users u ON u.id=t.owner_user_id AND u.status='active' JOIN profiles p ON p.user_id=t.owner_user_id WHERE t.id=?",
    territory,
  );
  let place: string | null = null;
  if (region && assets) {
    const [longitude, latitude] = plotPoint(region, parsed.x + 0.5, parsed.y + 0.5);
    const dataset = placeDatasetAt(longitude, latitude);
    const index =
      dataset && (await assetJson<PlaceIndex>(assets, origin, `${dataset.path}/index.json`));
    if (dataset && index) {
      const cell = placeCell(longitude, latitude, index.cells);
      const chunk = index.roots.includes(cell.root)
        ? await assetJson<PlaceChunk>(
            assets,
            origin,
            `${dataset.path}/${cell.root.replace(':', '-')}.json`,
          )
        : null;
      const found = chunk && placeFromIndex(index, chunkValue(chunk, cell.row, cell.column));
      if (found) place = placeName(found, locale);
    }
  }
  const ko = locale === 'ko';
  const where = place ?? (ko ? `구역 ${parsed.x}-${parsed.y}` : `Plot ${parsed.x}-${parsed.y}`);
  return {
    title: owner
      ? ko
        ? `${owner.display_name}님의 땅 · ${where}`
        : `${owner.display_name}'s land · ${where}`
      : ko
        ? `주인 없는 땅 · ${where}`
        : `Unclaimed land · ${where}`,
    description: ko
      ? '실제 지구를 본뜬 WORLD에서 이 땅을 둘러보세요.'
      : 'Visit this piece of the real Earth in WORLD.',
  };
}
