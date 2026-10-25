-- Account achievements persist through season resets.
-- statement
CREATE TABLE achievements (user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('pioneer','grower','builder')), season_id TEXT NOT NULL REFERENCES seasons(id), earned_at INTEGER NOT NULL, PRIMARY KEY(user_id,kind)) STRICT;
-- statement
CREATE TRIGGER achievement_pioneer AFTER INSERT ON player_state BEGIN
 INSERT OR IGNORE INTO achievements VALUES(NEW.user_id,'pioneer',NEW.season_id,NEW.last_settled_at);
END;
-- statement
CREATE TRIGGER achievement_grower AFTER UPDATE OF territory_count ON player_state WHEN NEW.territory_count>=3 BEGIN
 INSERT OR IGNORE INTO achievements VALUES(NEW.user_id,'grower',NEW.season_id,NEW.last_settled_at);
END;
-- statement
CREATE TRIGGER achievement_builder AFTER INSERT ON structures BEGIN
 INSERT OR IGNORE INTO achievements SELECT owner_user_id,'builder',season_id,NEW.built_at FROM territories WHERE id=NEW.territory_id;
END;
-- statement
INSERT OR IGNORE INTO achievements SELECT user_id,'pioneer',season_id,last_settled_at FROM player_state ORDER BY last_settled_at;
-- statement
INSERT OR IGNORE INTO achievements SELECT user_id,'grower',season_id,last_settled_at FROM player_state WHERE territory_count>=3 ORDER BY last_settled_at;
-- statement
INSERT OR IGNORE INTO achievements SELECT t.owner_user_id,'builder',t.season_id,s.built_at FROM structures s JOIN territories t ON t.id=s.territory_id ORDER BY s.built_at;
