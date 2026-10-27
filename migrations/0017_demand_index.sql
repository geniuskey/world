-- Land ownership v2 demand index: market price = base value × demand index, where the index is the
-- median of recent nearby trade prices relative to their base value (docs/land-ownership.md).
-- Demand is kept per zoom-14 region (the "surrounding" area: 8×8 plots). Basis points: 10000 = 1.0.
-- The index moves at most `demand_daily_step_bp` from its value at the start of each UTC day.
-- statement
ALTER TABLE land_rules ADD COLUMN demand_window_seconds INTEGER NOT NULL DEFAULT 604800 CHECK(demand_window_seconds>0);
-- statement
ALTER TABLE land_rules ADD COLUMN demand_min_trades INTEGER NOT NULL DEFAULT 3 CHECK(demand_min_trades>=1);
-- statement
ALTER TABLE land_rules ADD COLUMN demand_min_bp INTEGER NOT NULL DEFAULT 5000 CHECK(demand_min_bp>0);
-- statement
ALTER TABLE land_rules ADD COLUMN demand_max_bp INTEGER NOT NULL DEFAULT 30000 CHECK(demand_max_bp>=demand_min_bp);
-- statement
ALTER TABLE land_rules ADD COLUMN demand_daily_step_bp INTEGER NOT NULL DEFAULT 500 CHECK(demand_daily_step_bp>0);
-- statement
CREATE TABLE land_demand (
 region_id TEXT NOT NULL, season_id TEXT NOT NULL REFERENCES seasons(id),
 index_bp INTEGER NOT NULL DEFAULT 10000 CHECK(index_bp>0),
 day_start_bp INTEGER NOT NULL DEFAULT 10000 CHECK(day_start_bp>0),
 day INTEGER NOT NULL DEFAULT 0,
 target_bp INTEGER CHECK(target_bp IS NULL OR target_bp>0),
 updated_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(region_id,season_id)
) STRICT;
-- Each trade's base value at the time it happened; the demand ratio is price over this base.
-- statement
ALTER TABLE land_trades ADD COLUMN base_gold INTEGER NOT NULL DEFAULT 0 CHECK(base_gold>=0);
-- Base value = location (10 turns of income) + facility build cost, before demand.
-- statement
DROP VIEW land_quotes;
-- statement
CREATE VIEW land_base AS
SELECT t.id AS territory_id, t.season_id, t.region_id, t.owner_user_id, t.acquired_at, t.acquired_price,
 10*(1+COALESCE(CAST(p.population/100 AS INTEGER),0))+CASE WHEN t.structure_type IS NULL THEN 0 ELSE 20 END AS base_price
FROM territories t LEFT JOIN territory_population p ON p.territory_id=t.id;
-- statement
CREATE VIEW land_market AS
SELECT b.territory_id, b.season_id, b.owner_user_id, b.acquired_at, b.acquired_price, b.base_price,
 COALESCE(d.index_bp,10000) AS demand_index_bp,
 (b.base_price*COALESCE(d.index_bp,10000)+9999)/10000 AS market_price
FROM land_base b LEFT JOIN land_demand d ON d.region_id=b.region_id AND d.season_id=b.season_id;
-- statement
CREATE VIEW land_quotes AS
SELECT m.territory_id, m.season_id, m.owner_user_id, m.acquired_at, m.acquired_price, m.base_price, m.demand_index_bp, m.market_price,
 (m.market_price*(100+r.buyout_premium_pct)+99)/100 AS buyout_price,
 COALESCE(m.acquired_at,0)+r.protection_seconds AS protected_until
FROM land_market m CROSS JOIN land_rules r;
-- Every trade moves its region's demand. The target is the median of the latest trade per buyer and
-- seller pair within the window (repeated pairs count once), if there are enough trades. The index
-- then moves toward the target, limited to ±demand_daily_step_bp of the day's starting index.
-- statement
CREATE TRIGGER land_trade_demand AFTER INSERT ON land_trades BEGIN
 INSERT OR IGNORE INTO land_demand(region_id,season_id,updated_at) SELECT t.region_id,NEW.season_id,NEW.created_at FROM territories t WHERE t.id=NEW.territory_id;
 UPDATE land_demand SET target_bp=(
  WITH recent AS (
   SELECT l.price_gold*10000/l.base_gold AS ratio FROM land_trades l JOIN territories t ON t.id=l.territory_id
   WHERE t.region_id=(SELECT region_id FROM territories WHERE id=NEW.territory_id) AND l.season_id=NEW.season_id AND l.base_gold>0
    AND l.created_at>NEW.created_at-(SELECT demand_window_seconds FROM land_rules)
    AND l.id=(SELECT x.id FROM land_trades x WHERE x.buyer_user_id=l.buyer_user_id AND x.seller_user_id=l.seller_user_id AND x.season_id=NEW.season_id AND x.created_at>NEW.created_at-(SELECT demand_window_seconds FROM land_rules) ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1)
  ), ranked AS (SELECT ratio, ROW_NUMBER() OVER (ORDER BY ratio) AS rn, COUNT(*) OVER () AS n FROM recent)
  SELECT CAST(AVG(ratio) AS INTEGER) FROM ranked WHERE n>=(SELECT demand_min_trades FROM land_rules) AND rn IN ((n+1)/2,(n+2)/2)
 ) WHERE region_id=(SELECT region_id FROM territories WHERE id=NEW.territory_id) AND season_id=NEW.season_id;
 UPDATE land_demand SET day_start_bp=CASE WHEN day=NEW.created_at/86400 THEN day_start_bp ELSE index_bp END,day=NEW.created_at/86400
  WHERE region_id=(SELECT region_id FROM territories WHERE id=NEW.territory_id) AND season_id=NEW.season_id;
 UPDATE land_demand SET index_bp=MAX((SELECT demand_min_bp FROM land_rules),MIN((SELECT demand_max_bp FROM land_rules),
   MIN(day_start_bp*(10000+(SELECT demand_daily_step_bp FROM land_rules))/10000,MAX(day_start_bp*(10000-(SELECT demand_daily_step_bp FROM land_rules))/10000,COALESCE(target_bp,index_bp))))
  ), updated_at=NEW.created_at
  WHERE region_id=(SELECT region_id FROM territories WHERE id=NEW.territory_id) AND season_id=NEW.season_id;
END;
-- Claims cost the market price (base value times demand). Migration 0014 defined the old price.
-- statement
DROP TRIGGER action_claim;
-- statement
CREATE TRIGGER action_claim AFTER INSERT ON actions WHEN NEW.type='claim' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.owner_user_id IS NULL AND t.terrain_type<>'water' AND r.status='open') THEN RAISE(ABORT,'TERRITORY_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM territories WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id)
  AND NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.season_id=target.season_id AND neighbor.gx IS NOT NULL AND ((neighbor.gx=target.gx AND neighbor.gy IN (target.gy-1,target.gy+1)) OR (neighbor.gy=target.gy AND neighbor.gx IN (target.gx-1,target.gx+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NOT NULL AND neighbor.owner_user_id=NEW.user_id)
  AND NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.region_id=target.region_id AND neighbor.season_id=target.season_id AND ((neighbor.x=target.x AND neighbor.y IN (target.y-1,target.y+1)) OR (neighbor.y=target.y AND neighbor.x IN (target.x-1,target.x+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NULL AND neighbor.owner_user_id=NEW.user_id) THEN RAISE(ABORT,'NOT_ADJACENT') END;
 SELECT CASE WHEN (SELECT energy_value FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<1 THEN RAISE(ABORT,'NO_ENERGY') END;
 UPDATE actions SET result_json=json_object('territory_id',json_extract(NEW.payload_json,'$.territory_id'),'price_gold',(SELECT market_price FROM land_market WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id'))) WHERE id=NEW.id;
 SELECT CASE WHEN (SELECT gold_balance FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold') THEN RAISE(ABORT,'INSUFFICIENT_FUNDS') END;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,-json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold'),'claim',NEW.id,NEW.created_at);
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,acquired_price=json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold'),version=version+1 WHERE id=json_extract(NEW.payload_json,'$.territory_id') AND owner_user_id IS NULL;
 UPDATE player_state SET energy_value=energy_value-1,territory_count=territory_count+1,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
END;
-- Buying records the base value so later trades can measure demand against it.
-- statement
DROP TRIGGER action_land_buy;
-- statement
CREATE TRIGGER action_land_buy AFTER INSERT ON actions WHEN NEW.type='buy' AND json_extract(NEW.payload_json,'$.territory_id') IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.owner_user_id IS NOT NULL AND r.status='open') THEN RAISE(ABORT,'TERRITORY_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM territories WHERE id=json_extract(NEW.payload_json,'$.territory_id') AND owner_user_id=NEW.user_id) THEN RAISE(ABORT,'SELF_TRADE') END;
 UPDATE actions SET result_json=(
  SELECT json_object('territory_id',q.territory_id,'kind',CASE WHEN l.id IS NULL THEN 'buyout' ELSE 'listing' END,'listing_id',l.id,'seller_user_id',q.owner_user_id,'price_gold',COALESCE(l.price_gold,q.buyout_price),'cost_basis_gold',q.acquired_price,'protected_until',q.protected_until)
  FROM land_quotes q LEFT JOIN land_listings l ON l.territory_id=q.territory_id AND l.status='open' AND l.seller_user_id=q.owner_user_id AND EXISTS(SELECT 1 FROM users u WHERE u.id=l.seller_user_id AND u.status='active')
  WHERE q.territory_id=json_extract(NEW.payload_json,'$.territory_id')) WHERE id=NEW.id;
 SELECT CASE WHEN json_extract(result_json,'$.price_gold')>json_extract(NEW.payload_json,'$.price_gold') THEN RAISE(ABORT,'PRICE_CHANGED') END FROM actions WHERE id=NEW.id;
 SELECT CASE WHEN json_extract(result_json,'$.kind')='buyout' AND NEW.created_at<json_extract(result_json,'$.protected_until') THEN RAISE(ABORT,'PROTECTED') END FROM actions WHERE id=NEW.id;
 SELECT CASE WHEN json_extract(a.result_json,'$.kind')='buyout' AND EXISTS(SELECT 1 FROM land_trades x WHERE x.kind='buyout' AND x.buyer_user_id=NEW.user_id AND x.seller_user_id=json_extract(a.result_json,'$.seller_user_id') AND x.created_at>NEW.created_at-(SELECT cooldown_seconds FROM land_rules)) THEN RAISE(ABORT,'BUYOUT_COOLDOWN') END FROM actions a WHERE a.id=NEW.id;
 SELECT CASE WHEN (SELECT energy_value FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<1 THEN RAISE(ABORT,'NO_ENERGY') END;
 SELECT CASE WHEN (SELECT gold_balance FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<json_extract(result_json,'$.price_gold') THEN RAISE(ABORT,'INSUFFICIENT_FUNDS') END FROM actions WHERE id=NEW.id;
 INSERT INTO land_trades(id,territory_id,season_id,kind,listing_id,buyer_user_id,seller_user_id,price_gold,cost_basis_gold,tax_gold,created_at,base_gold)
  SELECT NEW.id,json_extract(result_json,'$.territory_id'),NEW.season_id,json_extract(result_json,'$.kind'),json_extract(result_json,'$.listing_id'),NEW.user_id,json_extract(result_json,'$.seller_user_id'),price,basis,
  (MIN(MAX(0,price-basis),basis)*10+99)/100+(MAX(0,price-2*basis)*30+99)/100,NEW.created_at,
  (SELECT base_price FROM land_base WHERE territory_id=json_extract(result_json,'$.territory_id'))
  FROM (SELECT result_json,json_extract(result_json,'$.price_gold') AS price,json_extract(result_json,'$.cost_basis_gold') AS basis FROM actions WHERE id=NEW.id);
 UPDATE actions SET result_json=json_set(json_remove(result_json,'$.seller_user_id','$.protected_until','$.cost_basis_gold'),'$.tax_gold',(SELECT tax_gold FROM land_trades WHERE id=NEW.id)) WHERE id=NEW.id;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) SELECT buyer_user_id,season_id,-price_gold,'land_purchase',id,created_at FROM land_trades WHERE id=NEW.id;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) SELECT seller_user_id,season_id,price_gold-tax_gold,'land_sale',id,created_at FROM land_trades WHERE id=NEW.id;
 UPDATE land_listings SET status=CASE WHEN id=(SELECT listing_id FROM land_trades WHERE id=NEW.id) THEN 'filled' ELSE 'cancelled' END,buyer_user_id=CASE WHEN id=(SELECT listing_id FROM land_trades WHERE id=NEW.id) THEN NEW.user_id END WHERE territory_id=(SELECT territory_id FROM land_trades WHERE id=NEW.id) AND status='open';
 UPDATE player_state SET territory_count=territory_count-1,version=version+1 WHERE user_id=(SELECT seller_user_id FROM land_trades WHERE id=NEW.id) AND season_id=NEW.season_id;
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,acquired_price=(SELECT price_gold FROM land_trades WHERE id=NEW.id),version=version+1 WHERE id=(SELECT territory_id FROM land_trades WHERE id=NEW.id);
 UPDATE player_state SET energy_value=energy_value-1,territory_count=territory_count+1,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
END;
