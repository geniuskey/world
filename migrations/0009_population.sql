-- Exact plot footprints only: never spread a city total uniformly across game plots.
-- statement
CREATE TABLE territory_population (
 territory_id TEXT PRIMARY KEY,
 population REAL NOT NULL CHECK(population>=0 AND population<=100000000),
 year INTEGER NOT NULL CHECK(year BETWEEN 2000 AND 2030),
 source TEXT NOT NULL,
 footprint_json TEXT NOT NULL CHECK(json_valid(footprint_json)),
 effective_at INTEGER NOT NULL
) STRICT;
-- statement
DROP TRIGGER action_settle;
-- statement
CREATE TRIGGER action_settle AFTER INSERT ON actions WHEN NEW.type='settle' BEGIN
 UPDATE player_state SET
 energy_value=MIN(4,energy_value+MAX(0,(NEW.created_at-energy_updated_at)/21600)),
 energy_updated_at=CASE WHEN energy_value+MAX(0,(NEW.created_at-energy_updated_at)/21600)>=4 THEN NEW.created_at ELSE energy_updated_at+MAX(0,(NEW.created_at-energy_updated_at)/21600)*21600 END,
 last_settled_at=NEW.created_at,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 INSERT INTO gold_ledger(user_id,season_id,delta,reason,ref_id,created_at)
 SELECT NEW.user_id,NEW.season_id,SUM(MIN(28,(NEW.created_at-production_at)/21600) +
 COALESCE((SELECT CAST(p.population/100 AS INTEGER) *
 MIN(28,MAX(0,(NEW.created_at-MAX(territories.production_at,p.effective_at))/21600))
 FROM territory_population p WHERE p.territory_id=territories.id),0)),'production',NEW.id,NEW.created_at FROM territories WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id AND production_at<=NEW.created_at-21600 HAVING COUNT(*)>0;
 INSERT INTO resource_ledger(user_id,season_id,kind,delta,reason,ref_id,created_at)
 SELECT NEW.user_id,NEW.season_id,CASE terrain_type WHEN 'meadow' THEN 'food' WHEN 'forest' THEN 'wood' ELSE 'iron' END,
 SUM(MIN(28,(NEW.created_at-production_at)/21600)*(2+CASE WHEN structure_type IS NULL THEN 0 ELSE 2 END)),'production',NEW.id,NEW.created_at
 FROM territories WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id AND production_at<=NEW.created_at-21600 GROUP BY terrain_type;
 UPDATE player_state SET produced_total=produced_total+COALESCE((SELECT SUM(delta) FROM resource_ledger WHERE ref_id=NEW.id),0) WHERE user_id=NEW.user_id AND season_id=NEW.season_id;
 UPDATE territories SET production_at=production_at+((NEW.created_at-production_at)/21600)*21600 WHERE owner_user_id=NEW.user_id AND season_id=NEW.season_id AND production_at<=NEW.created_at-21600;
END;
