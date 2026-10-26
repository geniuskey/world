-- Land ownership v2 pricing: a first claim costs the plot's market price in Gold, burned.
-- Market price = 10 turns of the plot's own Gold income (1 base + 1 per 100 imported residents);
-- see shared/game.ts plotPrice. The free starter plot from joining is unchanged.
-- statement
DROP TRIGGER action_claim;
-- statement
CREATE TRIGGER action_claim AFTER INSERT ON actions WHEN NEW.type='claim' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.owner_user_id IS NULL AND t.terrain_type<>'water' AND r.status='open') THEN RAISE(ABORT,'TERRITORY_UNAVAILABLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.season_id=target.season_id AND neighbor.gx IS NOT NULL AND ((neighbor.gx=target.gx AND neighbor.gy IN (target.gy-1,target.gy+1)) OR (neighbor.gy=target.gy AND neighbor.gx IN (target.gx-1,target.gx+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NOT NULL AND neighbor.owner_user_id=NEW.user_id)
  AND NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.region_id=target.region_id AND neighbor.season_id=target.season_id AND ((neighbor.x=target.x AND neighbor.y IN (target.y-1,target.y+1)) OR (neighbor.y=target.y AND neighbor.x IN (target.x-1,target.x+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NULL AND neighbor.owner_user_id=NEW.user_id) THEN RAISE(ABORT,'NOT_ADJACENT') END;
 SELECT CASE WHEN (SELECT energy_value FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<1 THEN RAISE(ABORT,'NO_ENERGY') END;
 UPDATE actions SET result_json=json_object('territory_id',json_extract(NEW.payload_json,'$.territory_id'),'price_gold',10*(1+COALESCE((SELECT CAST(population/100 AS INTEGER) FROM territory_population WHERE territory_id=json_extract(NEW.payload_json,'$.territory_id')),0))) WHERE id=NEW.id;
 SELECT CASE WHEN (SELECT gold_balance FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold') THEN RAISE(ABORT,'INSUFFICIENT_FUNDS') END;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,-json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.price_gold'),'claim',NEW.id,NEW.created_at);
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,version=version+1 WHERE id=json_extract(NEW.payload_json,'$.territory_id') AND owner_user_id IS NULL;
 UPDATE player_state SET energy_value=energy_value-1,territory_count=territory_count+1,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
END;
