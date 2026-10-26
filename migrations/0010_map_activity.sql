CREATE INDEX action_map_recent ON actions(season_id,created_at DESC);
-- statement
CREATE INDEX action_map_territory ON actions(season_id,json_extract(result_json,'$.territory_id'),created_at DESC);
