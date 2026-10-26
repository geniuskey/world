-- Real land cover for plots (ESA WorldCover, imported by scripts/landcover.mjs). A set covers a
-- longitude/latitude box; a plot region inside it without a row is open water. Each row holds
-- one land-cover letter per plot, row-major (index y*8+x), see shared/landCover.ts.
-- statement
CREATE TABLE land_cover_sets (
 id TEXT PRIMARY KEY, west REAL NOT NULL, south REAL NOT NULL, east REAL NOT NULL, north REAL NOT NULL,
 source TEXT NOT NULL, license TEXT NOT NULL, year INTEGER NOT NULL, imported_at INTEGER NOT NULL
) STRICT;
-- statement
CREATE TABLE region_land_cover (
 region_id TEXT PRIMARY KEY, set_id TEXT NOT NULL REFERENCES land_cover_sets(id),
 classes TEXT NOT NULL CHECK(length(classes)=64 AND classes NOT GLOB '*[^tsgcubiweo]*')
) STRICT;
-- Real land cover of an allocated plot; NULL where terrain is still generated.
-- statement
ALTER TABLE territories ADD COLUMN land_cover TEXT CHECK(land_cover IS NULL OR length(land_cover)=1);
