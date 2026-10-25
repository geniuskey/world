-- statement
CREATE TABLE users (
 id TEXT PRIMARY KEY, auth_provider TEXT NOT NULL, provider_subject TEXT NOT NULL,
 created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked')),
 role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')), is_test INTEGER NOT NULL DEFAULT 0,
 UNIQUE(auth_provider,provider_subject)
) STRICT;
-- statement
CREATE TABLE profiles (user_id TEXT PRIMARY KEY REFERENCES users(id), display_name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'en', flag_style TEXT NOT NULL DEFAULT 'fern', created_at INTEGER NOT NULL) STRICT;
-- statement
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL) STRICT;
-- statement
CREATE INDEX sessions_expiry ON sessions(expires_at);
-- statement
CREATE TABLE oauth_attempts (state_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, profile_json TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
-- statement
CREATE INDEX oauth_expiry ON oauth_attempts(expires_at);
-- statement
CREATE TABLE seasons (id TEXT PRIMARY KEY, begins_at INTEGER NOT NULL, ends_at INTEGER NOT NULL CHECK(ends_at>begins_at), status TEXT NOT NULL CHECK(status IN ('active','ended','upcoming')), rules_version TEXT NOT NULL) STRICT;
-- statement
CREATE UNIQUE INDEX one_active_season ON seasons(status) WHERE status='active';
-- statement
CREATE TABLE regions (id TEXT NOT NULL, season_id TEXT NOT NULL REFERENCES seasons(id), name TEXT NOT NULL, subtitle TEXT NOT NULL, longitude REAL NOT NULL, latitude REAL NOT NULL, width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 256), height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 256), status TEXT NOT NULL DEFAULT 'open', map_version INTEGER NOT NULL DEFAULT 1, owned_count INTEGER NOT NULL DEFAULT 0, land_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(id,season_id)) STRICT;
-- statement
CREATE TABLE territories (
 id TEXT PRIMARY KEY, region_id TEXT NOT NULL, season_id TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
 cx INTEGER NOT NULL, cy INTEGER NOT NULL, terrain_type TEXT NOT NULL CHECK(terrain_type IN ('meadow','forest','mountain','water')),
 owner_user_id TEXT REFERENCES users(id), acquired_at INTEGER, production_at INTEGER, version INTEGER NOT NULL DEFAULT 1,
 is_starter INTEGER NOT NULL DEFAULT 0, structure_type TEXT CHECK(structure_type IN ('farm','lumberyard','mine')),
 UNIQUE(region_id,x,y,season_id), FOREIGN KEY(region_id,season_id) REFERENCES regions(id,season_id),
 CHECK(owner_user_id IS NULL OR terrain_type<>'water')
) STRICT;
-- statement
CREATE INDEX territory_chunk ON territories(season_id,region_id,cx,cy);
-- statement
CREATE INDEX territory_owner ON territories(owner_user_id,season_id);
-- statement
CREATE INDEX territory_starter ON territories(season_id,region_id,is_starter,owner_user_id);
-- statement
CREATE TABLE chunk_versions (season_id TEXT NOT NULL, region_id TEXT NOT NULL, cx INTEGER NOT NULL, cy INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(season_id,region_id,cx,cy)) STRICT;
-- statement
CREATE TRIGGER territory_version AFTER UPDATE OF owner_user_id,version ON territories WHEN OLD.version<>NEW.version OR OLD.owner_user_id IS NOT NEW.owner_user_id BEGIN
 UPDATE chunk_versions SET version=version+1 WHERE season_id=NEW.season_id AND region_id=NEW.region_id AND cx=NEW.cx AND cy=NEW.cy;
 UPDATE regions SET map_version=map_version+1,owned_count=owned_count+(NEW.owner_user_id IS NOT NULL)-(OLD.owner_user_id IS NOT NULL) WHERE id=NEW.region_id AND season_id=NEW.season_id;
END;
-- statement
CREATE TABLE player_state (user_id TEXT NOT NULL REFERENCES users(id), season_id TEXT NOT NULL REFERENCES seasons(id), energy_value INTEGER NOT NULL CHECK(energy_value BETWEEN 0 AND 4), energy_updated_at INTEGER NOT NULL, gold_balance INTEGER NOT NULL DEFAULT 0 CHECK(gold_balance>=0), last_settled_at INTEGER NOT NULL, territory_count INTEGER NOT NULL DEFAULT 0 CHECK(territory_count>=0), produced_total INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,season_id)) STRICT;
-- statement
CREATE INDEX player_rank ON player_state(season_id,territory_count DESC,produced_total DESC);
-- statement
CREATE TABLE resources (user_id TEXT NOT NULL, season_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('food','wood','iron')), quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0), PRIMARY KEY(user_id,season_id,kind), FOREIGN KEY(user_id,season_id) REFERENCES player_state(user_id,season_id)) STRICT;
-- statement
CREATE TABLE structures (id TEXT PRIMARY KEY, territory_id TEXT NOT NULL UNIQUE REFERENCES territories(id), structure_type TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1 CHECK(level=1), built_at INTEGER NOT NULL) STRICT;
-- statement
CREATE TABLE actions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), season_id TEXT NOT NULL REFERENCES seasons(id), type TEXT NOT NULL CHECK(type IN ('join','settle','claim','build','sell','buy','cancel')), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), status TEXT NOT NULL DEFAULT 'completed', result_json TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id,idempotency_key)) STRICT;
-- statement
CREATE INDEX action_history ON actions(user_id,season_id,created_at DESC);
-- statement
CREATE INDEX action_cooldown ON actions(user_id,type,created_at DESC);
-- statement
CREATE TABLE gold_ledger (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, season_id TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, ref_id TEXT NOT NULL REFERENCES actions(id), created_at INTEGER NOT NULL, FOREIGN KEY(user_id,season_id) REFERENCES player_state(user_id,season_id), UNIQUE(user_id,ref_id,reason)) STRICT;
-- statement
CREATE INDEX gold_history ON gold_ledger(user_id,season_id,created_at DESC);
-- statement
CREATE TABLE resource_ledger (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, season_id TEXT NOT NULL, kind TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, ref_id TEXT NOT NULL REFERENCES actions(id), created_at INTEGER NOT NULL, FOREIGN KEY(user_id,season_id,kind) REFERENCES resources(user_id,season_id,kind), UNIQUE(user_id,ref_id,kind,reason)) STRICT;
-- statement
CREATE INDEX resource_history ON resource_ledger(user_id,season_id,created_at DESC);
-- statement
CREATE TABLE gems_ledger (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, ref_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT;
-- statement
CREATE TRIGGER gold_apply AFTER INSERT ON gold_ledger BEGIN UPDATE player_state SET gold_balance=gold_balance+NEW.delta,version=version+1 WHERE user_id=NEW.user_id AND season_id=NEW.season_id; END;
-- statement
CREATE TRIGGER resource_apply AFTER INSERT ON resource_ledger BEGIN UPDATE resources SET quantity=quantity+NEW.delta WHERE user_id=NEW.user_id AND season_id=NEW.season_id AND kind=NEW.kind; END;
-- statement
CREATE TRIGGER gold_no_update BEFORE UPDATE ON gold_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TRIGGER gold_no_delete BEFORE DELETE ON gold_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TRIGGER resource_no_update BEFORE UPDATE ON resource_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TRIGGER resource_no_delete BEFORE DELETE ON resource_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TRIGGER gems_no_update BEFORE UPDATE ON gems_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TRIGGER gems_no_delete BEFORE DELETE ON gems_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TABLE market_orders (id TEXT PRIMARY KEY REFERENCES actions(id), seller_user_id TEXT NOT NULL REFERENCES users(id), season_id TEXT NOT NULL REFERENCES seasons(id), kind TEXT NOT NULL CHECK(kind IN ('food','wood','iron')), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000), price_gold INTEGER NOT NULL CHECK(price_gold BETWEEN 1 AND 10000), status TEXT NOT NULL CHECK(status IN ('open','filled','cancelled')), created_at INTEGER NOT NULL, buyer_user_id TEXT REFERENCES users(id)) STRICT;
-- statement
CREATE INDEX market_listing ON market_orders(season_id,status,kind,created_at DESC);
-- statement
CREATE INDEX market_seller ON market_orders(seller_user_id,season_id,status);
-- statement
CREATE TABLE trade_ledger (id TEXT PRIMARY KEY REFERENCES actions(id), order_id TEXT NOT NULL UNIQUE REFERENCES market_orders(id), buyer_user_id TEXT NOT NULL REFERENCES users(id), seller_user_id TEXT NOT NULL REFERENCES users(id), season_id TEXT NOT NULL REFERENCES seasons(id), gold_amount INTEGER NOT NULL CHECK(gold_amount>0), tax_gold INTEGER NOT NULL CHECK(tax_gold>0), asset_json TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
-- statement
CREATE TRIGGER trade_no_update BEFORE UPDATE ON trade_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TRIGGER trade_no_delete BEFORE DELETE ON trade_ledger BEGIN SELECT RAISE(ABORT,'IMMUTABLE_LEDGER'); END;
-- statement
CREATE TABLE reports (id TEXT PRIMARY KEY, reporter_user_id TEXT NOT NULL REFERENCES users(id), target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), created_at INTEGER NOT NULL, resolved_by TEXT REFERENCES users(id)) STRICT;
-- statement
CREATE INDEX report_queue ON reports(status,created_at DESC);
-- statement
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
-- statement
CREATE INDEX rate_expiry ON rate_limits(expires_at);
-- statement
CREATE TABLE daily_metrics (day TEXT NOT NULL, route TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, rows_read INTEGER NOT NULL DEFAULT 0, rows_written INTEGER NOT NULL DEFAULT 0, cache_hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,route)) STRICT;
-- statement
CREATE TABLE visits (user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, event TEXT NOT NULL CHECK(event IN ('visit','map','territory')), PRIMARY KEY(user_id,day,event)) STRICT;
-- statement
CREATE TABLE leaderboard_snapshots (season_id TEXT PRIMARY KEY REFERENCES seasons(id), generated_at INTEGER NOT NULL, rows_json TEXT NOT NULL) STRICT;
