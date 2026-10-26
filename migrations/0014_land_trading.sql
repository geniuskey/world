-- Land ownership v2 trading: owned plots can be listed, bought from a listing, or force-bought
-- at the buyout price. Land actions reuse the sell/buy/cancel action types and are told apart
-- from resource orders by a territory_id in the payload. See docs/land-ownership.md.
-- statement
CREATE TABLE land_rules (
 id INTEGER PRIMARY KEY CHECK(id=1),
 buyout_premium_pct INTEGER NOT NULL DEFAULT 20 CHECK(buyout_premium_pct BETWEEN 0 AND 100),
 protection_seconds INTEGER NOT NULL DEFAULT 604800 CHECK(protection_seconds>=0),
 cooldown_seconds INTEGER NOT NULL DEFAULT 604800 CHECK(cooldown_seconds>=0)
) STRICT;
-- statement
INSERT INTO land_rules(id) VALUES(1);
-- Gold the current owner paid for the plot; the cost basis for the transfer tax.
-- statement
ALTER TABLE territories ADD COLUMN acquired_price INTEGER NOT NULL DEFAULT 0 CHECK(acquired_price>=0);
-- statement
UPDATE territories SET acquired_price=COALESCE((SELECT json_extract(a.result_json,'$.price_gold') FROM actions a WHERE a.type='claim' AND a.user_id=territories.owner_user_id AND json_extract(a.result_json,'$.territory_id')=territories.id ORDER BY a.created_at DESC LIMIT 1),0) WHERE owner_user_id IS NOT NULL;
-- A facility's Gold cost becomes part of the plot's value and the owner's cost basis.
-- statement
CREATE TRIGGER structure_cost_basis AFTER INSERT ON structures BEGIN
 UPDATE territories SET acquired_price=acquired_price+20 WHERE id=NEW.territory_id;
END;
-- statement
UPDATE territories SET acquired_price=acquired_price+20 WHERE structure_type IS NOT NULL AND owner_user_id IS NOT NULL;
-- Market price = location value (10 turns of income) + facility build cost; buyout adds the premium.
-- statement
CREATE VIEW land_quotes AS
SELECT t.id AS territory_id, t.season_id, t.owner_user_id, t.acquired_at, t.acquired_price,
 10*(1+COALESCE(CAST(p.population/100 AS INTEGER),0))+CASE WHEN t.structure_type IS NULL THEN 0 ELSE 20 END AS market_price,
 (( 10*(1+COALESCE(CAST(p.population/100 AS INTEGER),0))+CASE WHEN t.structure_type IS NULL THEN 0 ELSE 20 END)*(100+r.buyout_premium_pct)+99)/100 AS buyout_price,
 COALESCE(t.acquired_at,0)+r.protection_seconds AS protected_until
FROM territories t LEFT JOIN territory_population p ON p.territory_id=t.id CROSS JOIN land_rules r;
-- statement
CREATE TABLE land_listings (
 id TEXT PRIMARY KEY REFERENCES actions(id), territory_id TEXT NOT NULL REFERENCES territories(id),
 seller_user_id TEXT NOT NULL REFERENCES users(id), season_id TEXT NOT NULL REFERENCES seasons(id),
 price_gold INTEGER NOT NULL CHECK(price_gold BETWEEN 1 AND 1000000),
 status TEXT NOT NULL CHECK(status IN ('open','filled','cancelled')), created_at INTEGER NOT NULL,
 buyer_user_id TEXT REFERENCES users(id)
) STRICT;
-- statement
CREATE UNIQUE INDEX land_listing_open ON land_listings(territory_id) WHERE status='open';
-- statement
CREATE INDEX land_listing_recent ON land_listings(season_id,status,created_at DESC);
-- statement
CREATE INDEX land_listing_seller ON land_listings(seller_user_id,season_id,status);
-- Permanent, append-only record of every change of hands after the first claim.
-- statement
CREATE TABLE land_trades (
 id TEXT PRIMARY KEY REFERENCES actions(id), territory_id TEXT NOT NULL REFERENCES territories(id),
 season_id TEXT NOT NULL REFERENCES seasons(id), kind TEXT NOT NULL CHECK(kind IN ('listing','buyout')),
 listing_id TEXT REFERENCES land_listings(id), buyer_user_id TEXT NOT NULL REFERENCES users(id),
 seller_user_id TEXT NOT NULL REFERENCES users(id), price_gold INTEGER NOT NULL CHECK(price_gold>0),
 cost_basis_gold INTEGER NOT NULL CHECK(cost_basis_gold>=0), tax_gold INTEGER NOT NULL CHECK(tax_gold>=0 AND tax_gold<=price_gold),
 created_at INTEGER NOT NULL
) STRICT;
-- statement
CREATE INDEX land_trade_territory ON land_trades(territory_id,created_at DESC);
-- statement
CREATE INDEX land_trade_pair ON land_trades(buyer_user_id,seller_user_id,kind,created_at DESC);
-- statement
CREATE TRIGGER land_trade_no_update BEFORE UPDATE ON land_trades BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TRIGGER land_trade_no_delete BEFORE DELETE ON land_trades BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- Resource market triggers now ignore land payloads.
-- statement
DROP TRIGGER action_sell;
-- statement
CREATE TRIGGER action_sell AFTER INSERT ON actions WHEN NEW.type='sell' AND json_extract(NEW.payload_json,'$.territory_id') IS NULL BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM market_orders WHERE seller_user_id=NEW.user_id AND season_id=NEW.season_id AND status='open')>=20 THEN RAISE(ABORT,'ORDER_LIMIT') END;
 SELECT CASE WHEN COALESCE((SELECT quantity FROM resources WHERE user_id=NEW.user_id AND season_id=NEW.season_id AND kind=json_extract(NEW.payload_json,'$.kind')),0)<json_extract(NEW.payload_json,'$.quantity') THEN RAISE(ABORT,'INSUFFICIENT_RESOURCES') END;
 INSERT INTO market_orders(id,seller_user_id,season_id,kind,quantity,price_gold,status,created_at) VALUES(NEW.id,NEW.user_id,NEW.season_id,json_extract(NEW.payload_json,'$.kind'),json_extract(NEW.payload_json,'$.quantity'),json_extract(NEW.payload_json,'$.price_gold'),'open',NEW.created_at);
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,json_extract(NEW.payload_json,'$.kind'),-json_extract(NEW.payload_json,'$.quantity'),'escrow',NEW.id,NEW.created_at);
 UPDATE actions SET result_json=json_object('order_id',NEW.id) WHERE id=NEW.id;
END;
-- statement
DROP TRIGGER action_buy;
-- statement
CREATE TRIGGER action_buy AFTER INSERT ON actions WHEN NEW.type='buy' AND json_extract(NEW.payload_json,'$.territory_id') IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id') AND season_id=NEW.season_id AND status='open') THEN RAISE(ABORT,'ORDER_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id') AND seller_user_id=NEW.user_id) THEN RAISE(ABORT,'SELF_TRADE') END;
 SELECT CASE WHEN (SELECT gold_balance FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<(SELECT quantity*price_gold FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id')) THEN RAISE(ABORT,'INSUFFICIENT_FUNDS') END;
 UPDATE market_orders SET status='filled',buyer_user_id=NEW.user_id WHERE id=json_extract(NEW.payload_json,'$.order_id') AND status='open';
 INSERT INTO trade_ledger(id,order_id,buyer_user_id,seller_user_id,season_id,gold_amount,tax_gold,asset_json,created_at) SELECT NEW.id,id,NEW.user_id,seller_user_id,NEW.season_id,quantity*price_gold,(quantity*price_gold*3+99)/100,json_object('kind',kind,'quantity',quantity),NEW.created_at FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id');
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) SELECT NEW.user_id,NEW.season_id,-gold_amount,'purchase',NEW.id,NEW.created_at FROM trade_ledger WHERE id=NEW.id;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) SELECT seller_user_id,NEW.season_id,gold_amount-tax_gold,'sale',NEW.id,NEW.created_at FROM trade_ledger WHERE id=NEW.id;
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) SELECT NEW.user_id,NEW.season_id,kind,quantity,'purchase',NEW.id,NEW.created_at FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id');
 UPDATE actions SET result_json=json_object('order_id',json_extract(NEW.payload_json,'$.order_id')) WHERE id=NEW.id;
END;
-- statement
DROP TRIGGER action_cancel;
-- statement
CREATE TRIGGER action_cancel AFTER INSERT ON actions WHEN NEW.type='cancel' AND json_extract(NEW.payload_json,'$.territory_id') IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id') AND seller_user_id=NEW.user_id AND season_id=NEW.season_id AND status='open') THEN RAISE(ABORT,'ORDER_UNAVAILABLE') END;
 UPDATE market_orders SET status='cancelled' WHERE id=json_extract(NEW.payload_json,'$.order_id');
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) SELECT NEW.user_id,NEW.season_id,kind,quantity,'cancel',NEW.id,NEW.created_at FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id');
 UPDATE actions SET result_json=json_object('order_id',json_extract(NEW.payload_json,'$.order_id')) WHERE id=NEW.id;
END;
-- Listing: the owner asks any price up to the buyout price. The plot itself is the escrow:
-- it stays with the seller (and keeps producing) until a buyer fills the listing.
-- statement
CREATE TRIGGER action_land_list AFTER INSERT ON actions WHEN NEW.type='sell' AND json_extract(NEW.payload_json,'$.territory_id') IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.owner_user_id=NEW.user_id AND r.status='open') THEN RAISE(ABORT,'NOT_OWNER') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM land_listings WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id') AND status='open') THEN RAISE(ABORT,'ALREADY_LISTED') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM land_listings WHERE seller_user_id=NEW.user_id AND season_id=NEW.season_id AND status='open')>=20 THEN RAISE(ABORT,'ORDER_LIMIT') END;
 SELECT CASE WHEN json_extract(NEW.payload_json,'$.price_gold')>(SELECT buyout_price FROM land_quotes WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id')) THEN RAISE(ABORT,'ABOVE_BUYOUT_PRICE') END;
 INSERT INTO land_listings(id,territory_id,seller_user_id,season_id,price_gold,status,created_at) VALUES(NEW.id,json_extract(NEW.payload_json,'$.territory_id'),NEW.user_id,NEW.season_id,json_extract(NEW.payload_json,'$.price_gold'),'open',NEW.created_at);
 UPDATE actions SET result_json=json_object('listing_id',NEW.id,'territory_id',json_extract(NEW.payload_json,'$.territory_id'),'price_gold',json_extract(NEW.payload_json,'$.price_gold')) WHERE id=NEW.id;
END;
-- statement
CREATE TRIGGER action_land_unlist AFTER INSERT ON actions WHEN NEW.type='cancel' AND json_extract(NEW.payload_json,'$.territory_id') IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM land_listings WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id') AND seller_user_id=NEW.user_id AND season_id=NEW.season_id AND status='open') THEN RAISE(ABORT,'LISTING_UNAVAILABLE') END;
 UPDATE actions SET result_json=json_object('listing_id',(SELECT id FROM land_listings WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id') AND status='open'),'territory_id',json_extract(NEW.payload_json,'$.territory_id')) WHERE id=NEW.id;
 UPDATE land_listings SET status='cancelled' WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id') AND status='open';
END;
-- Buying: an open listing from an active seller is filled at its asking price; otherwise the
-- plot is force-bought at the buyout price. price_gold in the payload is the most the buyer
-- agreed to pay. Protection and the per-pair cooldown apply only to forced buyouts.
-- Transfer tax, burned: 10% of the gain up to the cost basis, 30% of the gain above it.
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
 INSERT INTO land_trades(id,territory_id,season_id,kind,listing_id,buyer_user_id,seller_user_id,price_gold,cost_basis_gold,tax_gold,created_at)
  SELECT NEW.id,json_extract(result_json,'$.territory_id'),NEW.season_id,json_extract(result_json,'$.kind'),json_extract(result_json,'$.listing_id'),NEW.user_id,json_extract(result_json,'$.seller_user_id'),price,basis,
  (MIN(MAX(0,price-basis),basis)*10+99)/100+(MAX(0,price-2*basis)*30+99)/100,NEW.created_at
  FROM (SELECT result_json,json_extract(result_json,'$.price_gold') AS price,json_extract(result_json,'$.cost_basis_gold') AS basis FROM actions WHERE id=NEW.id);
 UPDATE actions SET result_json=json_set(json_remove(result_json,'$.seller_user_id','$.protected_until','$.cost_basis_gold'),'$.tax_gold',(SELECT tax_gold FROM land_trades WHERE id=NEW.id)) WHERE id=NEW.id;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) SELECT buyer_user_id,season_id,-price_gold,'land_purchase',id,created_at FROM land_trades WHERE id=NEW.id;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) SELECT seller_user_id,season_id,price_gold-tax_gold,'land_sale',id,created_at FROM land_trades WHERE id=NEW.id;
 UPDATE land_listings SET status=CASE WHEN id=(SELECT listing_id FROM land_trades WHERE id=NEW.id) THEN 'filled' ELSE 'cancelled' END,buyer_user_id=CASE WHEN id=(SELECT listing_id FROM land_trades WHERE id=NEW.id) THEN NEW.user_id END WHERE territory_id=(SELECT territory_id FROM land_trades WHERE id=NEW.id) AND status='open';
 UPDATE player_state SET territory_count=territory_count-1,version=version+1 WHERE user_id=(SELECT seller_user_id FROM land_trades WHERE id=NEW.id) AND season_id=NEW.season_id;
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,acquired_price=(SELECT price_gold FROM land_trades WHERE id=NEW.id),version=version+1 WHERE id=(SELECT territory_id FROM land_trades WHERE id=NEW.id);
 UPDATE player_state SET energy_value=energy_value-1,territory_count=territory_count+1,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
END;
-- Claims record their price as the cost basis, and a player who has lost every plot may
-- claim any open plot to start again.
-- statement
DROP TRIGGER action_claim;
-- statement
CREATE TRIGGER action_claim AFTER INSERT ON actions WHEN NEW.type='claim' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.owner_user_id IS NULL AND t.terrain_type<>'water' AND r.status='open') THEN RAISE(ABORT,'TERRITORY_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM territories WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id)
  AND NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.season_id=target.season_id AND neighbor.gx IS NOT NULL AND ((neighbor.gx=target.gx AND neighbor.gy IN (target.gy-1,target.gy+1)) OR (neighbor.gy=target.gy AND neighbor.gx IN (target.gx-1,target.gx+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NOT NULL AND neighbor.owner_user_id=NEW.user_id)
  AND NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.region_id=target.region_id AND neighbor.season_id=target.season_id AND ((neighbor.x=target.x AND neighbor.y IN (target.y-1,target.y+1)) OR (neighbor.y=target.y AND neighbor.x IN (target.x-1,target.x+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NULL AND neighbor.owner_user_id=NEW.user_id) THEN RAISE(ABORT,'NOT_ADJACENT') END;
 SELECT CASE WHEN (SELECT energy_value FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<1 THEN RAISE(ABORT,'NO_ENERGY') END;
 UPDATE actions SET result_json=json_object('territory_id',json_extract(NEW.payload_json,'$.territory_id'),'price_gold',10*(1+COALESCE((SELECT CAST(population/100 AS INTEGER) FROM territory_population WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id')),0))) WHERE id=NEW.id;
 SELECT CASE WHEN (SELECT gold_balance FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold') THEN RAISE(ABORT,'INSUFFICIENT_FUNDS') END;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,-json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold'),'claim',NEW.id,NEW.created_at);
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,acquired_price=json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold'),version=version+1 WHERE id=json_extract(NEW.payload_json,'$.territory_id') AND owner_user_id IS NULL;
 UPDATE player_state SET energy_value=energy_value-1,territory_count=territory_count+1,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
END;
