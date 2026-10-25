-- Virtual million-cell roots need rows only for visited settlements and splits.
-- Earlier coarse-grid saves retain their original IDs and bounds.
-- statement
CREATE INDEX world_tile_view ON world_tiles(season_id,west,east,south,north);
