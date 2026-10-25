-- Settlement aggregates only the resource entries for its own command.
-- statement
CREATE INDEX resource_command ON resource_ledger(ref_id);
-- statement
CREATE INDEX trade_season ON trade_ledger(season_id,created_at);
