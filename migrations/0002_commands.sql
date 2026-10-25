-- Each action INSERT and every trigger it invokes form one SQLite transaction.
-- statement
CREATE TRIGGER action_guard BEFORE INSERT ON actions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND status='active') THEN RAISE(ABORT,'ACCOUNT_BLOCKED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM seasons WHERE id=NEW.season_id AND status='active' AND begins_at<=NEW.created_at AND ends_at>NEW.created_at) THEN RAISE(ABORT,'SEASON_ENDED') END;
 SELECT CASE WHEN NEW.type<>'join' AND NOT EXISTS(SELECT 1 FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id) THEN RAISE(ABORT,'NOT_JOINED') END;
END;
-- statement
CREATE TRIGGER action_join AFTER INSERT ON actions WHEN NEW.type='join' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id) THEN RAISE(ABORT,'ALREADY_JOINED') END;
 UPDATE actions SET result_json=json_object('territory_id',(SELECT t.id FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.season_id=NEW.season_id AND t.region_id=json_extract(NEW.payload_json,'$.region_id') AND t.is_starter=1 AND t.owner_user_id IS NULL AND r.status='open' ORDER BY t.y,t.x LIMIT 1)) WHERE id=NEW.id;
 SELECT CASE WHEN json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.territory_id') IS NULL THEN RAISE(ABORT,'REGION_FULL') END;
 INSERT INTO player_state(user_id,season_id,energy_value,energy_updated_at,last_settled_at,territory_count) VALUES(NEW.user_id,NEW.season_id,4,NEW.created_at,NEW.created_at,1);
 INSERT INTO resources(user_id,season_id,kind) VALUES(NEW.user_id,NEW.season_id,'food'),(NEW.user_id,NEW.season_id,'wood'),(NEW.user_id,NEW.season_id,'iron');
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,100,'starter',NEW.id,NEW.created_at);
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) SELECT NEW.user_id,NEW.season_id,kind,12,'starter',NEW.id,NEW.created_at FROM resources WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,version=version+1 WHERE id=json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.territory_id') AND owner_user_id IS NULL;
END;
-- statement
CREATE TRIGGER action_settle AFTER INSERT ON actions WHEN NEW.type='settle' BEGIN
 UPDATE player_state SET
 energy_value=MIN(4,energy_value+MAX(0,(NEW.created_at-energy_updated_at)/21600)),
 energy_updated_at=CASE WHEN energy_value+MAX(0,(NEW.created_at-energy_updated_at)/21600)>=4 THEN NEW.created_at ELSE energy_updated_at+MAX(0,(NEW.created_at-energy_updated_at)/21600)*21600 END,
 last_settled_at=NEW.created_at,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at)
 SELECT NEW.user_id,NEW.season_id,SUM(MIN(28,(NEW.created_at-production_at)/21600)),'production',NEW.id,NEW.created_at FROM territories WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id AND production_at<=NEW.created_at-21600 HAVING COUNT(*)>0;
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at)
 SELECT NEW.user_id,NEW.season_id,CASE terrain_type WHEN 'meadow' THEN 'food' WHEN 'forest' THEN 'wood' ELSE 'iron' END,
 SUM(MIN(28,(NEW.created_at-production_at)/21600)*(2+CASE WHEN structure_type IS NULL THEN 0 ELSE 2 END)),'production',NEW.id,NEW.created_at
 FROM territories WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id AND production_at<=NEW.created_at-21600 GROUP BY terrain_type;
 UPDATE player_state SET produced_total=produced_total+COALESCE((SELECT SUM(delta) FROM resource_ledger WHERE ref_id=NEW.id),0) WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 UPDATE territories SET production_at=production_at+((NEW.created_at-production_at)/21600)*21600 WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id AND production_at<=NEW.created_at-21600;
END;
-- statement
CREATE TRIGGER action_claim AFTER INSERT ON actions WHEN NEW.type='claim' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.owner_user_id IS NULL AND t.terrain_type<>'water' AND r.status='open') THEN RAISE(ABORT,'TERRITORY_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.region_id=target.region_id AND neighbor.season_id=target.season_id AND ((neighbor.x=target.x AND neighbor.y IN (target.y-1,target.y+1)) OR (neighbor.y=target.y AND neighbor.x IN (target.x-1,target.x+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND neighbor.owner_user_id=NEW.user_id) THEN RAISE(ABORT,'NOT_ADJACENT') END;
 SELECT CASE WHEN (SELECT energy_value FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<1 THEN RAISE(ABORT,'NO_ENERGY') END;
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,version=version+1 WHERE id=json_extract(NEW.payload_json,'$.territory_id') AND owner_user_id IS NULL;
 UPDATE player_state SET energy_value=energy_value-1,territory_count=territory_count+1,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 UPDATE actions SET result_json=json_object('territory_id',json_extract(NEW.payload_json,'$.territory_id')) WHERE id=NEW.id;
END;
-- statement
CREATE TRIGGER action_build AFTER INSERT ON actions WHEN NEW.type='build' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories WHERE id=json_extract(NEW.payload_json,'$.territory_id') AND owner_user_id=NEW.user_id AND season_id=NEW.season_id AND structure_type IS NULL) THEN RAISE(ABORT,'CANNOT_BUILD') END;
 SELECT CASE WHEN (SELECT gold_balance FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<20 OR (SELECT quantity FROM resources WHERE user_id=NEW.user_id AND season_id=NEW.season_id AND kind='wood')<8 OR (SELECT quantity FROM resources WHERE user_id=NEW.user_id AND season_id=NEW.season_id AND kind='iron')<4 THEN RAISE(ABORT,'INSUFFICIENT_FUNDS') END;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,-20,'build',NEW.id,NEW.created_at);
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,'wood',-8,'build',NEW.id,NEW.created_at),(NEW.user_id,NEW.season_id,'iron',-4,'build',NEW.id,NEW.created_at);
 INSERT INTO structures(id,territory_id,structure_type,built_at) SELECT NEW.id,id,CASE terrain_type WHEN 'meadow' THEN 'farm' WHEN 'forest' THEN 'lumberyard' ELSE 'mine' END,NEW.created_at FROM territories WHERE id=json_extract(NEW.payload_json,'$.territory_id');
 UPDATE territories SET structure_type=(SELECT structure_type FROM structures WHERE id=NEW.id),production_at=NEW.created_at,version=version+1 WHERE id=json_extract(NEW.payload_json,'$.territory_id');
 UPDATE actions SET result_json=json_object('territory_id',json_extract(NEW.payload_json,'$.territory_id')) WHERE id=NEW.id;
END;
-- statement
CREATE TRIGGER market_cooldown BEFORE INSERT ON actions WHEN NEW.type IN ('sell','buy') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM actions WHERE user_id=NEW.user_id AND type IN ('sell','buy') AND created_at>NEW.created_at-2) THEN RAISE(ABORT,'TRADE_COOLDOWN') END;
END;
-- statement
CREATE TRIGGER action_sell AFTER INSERT ON actions WHEN NEW.type='sell' BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM market_orders WHERE seller_user_id=NEW.user_id AND season_id=NEW.season_id AND status='open')>=20 THEN RAISE(ABORT,'ORDER_LIMIT') END;
 SELECT CASE WHEN COALESCE((SELECT quantity FROM resources WHERE user_id=NEW.user_id AND season_id=NEW.season_id AND kind=json_extract(NEW.payload_json,'$.kind')),0)<json_extract(NEW.payload_json,'$.quantity') THEN RAISE(ABORT,'INSUFFICIENT_RESOURCES') END;
 INSERT INTO market_orders(id,seller_user_id,season_id,kind,quantity,price_gold,status,created_at) VALUES(NEW.id,NEW.user_id,NEW.season_id,json_extract(NEW.payload_json,'$.kind'),json_extract(NEW.payload_json,'$.quantity'),json_extract(NEW.payload_json,'$.price_gold'),'open',NEW.created_at);
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,json_extract(NEW.payload_json,'$.kind'),-json_extract(NEW.payload_json,'$.quantity'),'escrow',NEW.id,NEW.created_at);
 UPDATE actions SET result_json=json_object('order_id',NEW.id) WHERE id=NEW.id;
END;
-- statement
CREATE TRIGGER action_buy AFTER INSERT ON actions WHEN NEW.type='buy' BEGIN
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
CREATE TRIGGER action_cancel AFTER INSERT ON actions WHEN NEW.type='cancel' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id') AND seller_user_id=NEW.user_id AND season_id=NEW.season_id AND status='open') THEN RAISE(ABORT,'ORDER_UNAVAILABLE') END;
 UPDATE market_orders SET status='cancelled' WHERE id=json_extract(NEW.payload_json,'$.order_id');
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) SELECT NEW.user_id,NEW.season_id,kind,quantity,'cancel',NEW.id,NEW.created_at FROM market_orders WHERE id=json_extract(NEW.payload_json,'$.order_id');
 UPDATE actions SET result_json=json_object('order_id',json_extract(NEW.payload_json,'$.order_id')) WHERE id=NEW.id;
END;
