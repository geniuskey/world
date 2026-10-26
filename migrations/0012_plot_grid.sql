-- Land ownership v2 grid: plots are global Web Mercator zoom-17 tiles, grouped into
-- zoom-14 regions (z14:x:y). Version 1 world-tile regions keep their rows and history
-- but are archived for new settlement and claims.
-- statement
ALTER TABLE territories ADD COLUMN gx INTEGER;
-- statement
ALTER TABLE territories ADD COLUMN gy INTEGER;
-- statement
CREATE UNIQUE INDEX territory_plot ON territories(season_id,gx,gy) WHERE gx IS NOT NULL;
-- statement
UPDATE regions SET status='archived' WHERE id NOT LIKE 'z14:%';
-- statement
DROP TRIGGER action_join;
-- statement
CREATE TRIGGER action_join AFTER INSERT ON actions WHEN NEW.type='join' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id) THEN RAISE(ABORT,'ALREADY_JOINED') END;
 -- A chosen plot must be open land in the requested region; otherwise take the first open starter.
 SELECT CASE WHEN json_extract(NEW.payload_json,'$.territory_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.region_id=json_extract(NEW.payload_json,'$.region_id') AND t.owner_user_id IS NULL AND t.terrain_type<>'water' AND r.status='open') THEN RAISE(ABORT,'TERRITORY_UNAVAILABLE') END;
 UPDATE actions SET result_json=json_object('territory_id',COALESCE(json_extract(NEW.payload_json,'$.territory_id'),(SELECT t.id FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.season_id=NEW.season_id AND t.region_id=json_extract(NEW.payload_json,'$.region_id') AND t.is_starter=1 AND t.owner_user_id IS NULL AND r.status='open' ORDER BY t.y,t.x LIMIT 1))) WHERE id=NEW.id;
 SELECT CASE WHEN json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.territory_id') IS NULL THEN RAISE(ABORT,'REGION_FULL') END;
 INSERT INTO player_state(user_id,season_id,energy_value,energy_updated_at,last_settled_at,territory_count) VALUES(NEW.user_id,NEW.season_id,4,NEW.created_at,NEW.created_at,1);
 INSERT INTO resources(user_id,season_id,kind) VALUES(NEW.user_id,NEW.season_id,'food'),(NEW.user_id,NEW.season_id,'wood'),(NEW.user_id,NEW.season_id,'iron');
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at) VALUES(NEW.user_id,NEW.season_id,100,'starter',NEW.id,NEW.created_at);
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at) SELECT NEW.user_id,NEW.season_id,kind,12,'starter',NEW.id,NEW.created_at FROM resources WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,version=version+1 WHERE id=json_extract((SELECT result_json FROM actions WHERE id=NEW.id),'$.territory_id') AND owner_user_id IS NULL;
END;
-- statement
DROP TRIGGER action_claim;
-- statement
CREATE TRIGGER action_claim AFTER INSERT ON actions WHEN NEW.type='claim' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories t JOIN regions r ON r.id=t.region_id AND r.season_id=t.season_id WHERE t.id=json_extract(NEW.payload_json,'$.territory_id') AND t.season_id=NEW.season_id AND t.owner_user_id IS NULL AND t.terrain_type<>'water' AND r.status='open') THEN RAISE(ABORT,'TERRITORY_UNAVAILABLE') END;
 -- Plot-grid neighbours are global, so territory grows across region edges.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.season_id=target.season_id AND neighbor.gx IS NOT NULL AND ((neighbor.gx=target.gx AND neighbor.gy IN (target.gy-1,target.gy+1)) OR (neighbor.gy=target.gy AND neighbor.gx IN (target.gx-1,target.gx+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NOT NULL AND neighbor.owner_user_id=NEW.user_id)
  AND NOT EXISTS(SELECT 1 FROM territories target JOIN territories neighbor ON neighbor.region_id=target.region_id AND neighbor.season_id=target.season_id AND ((neighbor.x=target.x AND neighbor.y IN (target.y-1,target.y+1)) OR (neighbor.y=target.y AND neighbor.x IN (target.x-1,target.x+1))) WHERE target.id=json_extract(NEW.payload_json,'$.territory_id') AND target.gx IS NULL AND neighbor.owner_user_id=NEW.user_id) THEN RAISE(ABORT,'NOT_ADJACENT') END;
 SELECT CASE WHEN (SELECT energy_value FROM player_state WHERE user_id=NEW.user_id AND season_id=NEW.season_id)<1 THEN RAISE(ABORT,'NO_ENERGY') END;
 UPDATE territories SET owner_user_id=NEW.user_id,acquired_at=NEW.created_at,production_at=NEW.created_at,version=version+1 WHERE id=json_extract(NEW.payload_json,'$.territory_id') AND owner_user_id IS NULL;
 UPDATE player_state SET energy_value=energy_value-1,territory_count=territory_count+1,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 UPDATE actions SET result_json=json_object('territory_id',json_extract(NEW.payload_json,'$.territory_id')) WHERE id=NEW.id;
END;
