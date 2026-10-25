-- Hierarchical settlement zones; existing regions and territory identifiers remain stable.
-- statement
CREATE TABLE world_tiles (
 id TEXT NOT NULL, season_id TEXT NOT NULL REFERENCES seasons(id), parent_id TEXT,
 level INTEGER NOT NULL, west REAL NOT NULL, south REAL NOT NULL, east REAL NOT NULL, north REAL NOT NULL,
 split INTEGER NOT NULL DEFAULT 0 CHECK(split IN (0,1)),
 PRIMARY KEY(id,season_id), FOREIGN KEY(id,season_id) REFERENCES regions(id,season_id),
 FOREIGN KEY(parent_id,season_id) REFERENCES world_tiles(id,season_id),
 CHECK(west<east AND south<north)
) STRICT;
-- statement
CREATE INDEX world_tile_parent ON world_tiles(season_id,parent_id);
