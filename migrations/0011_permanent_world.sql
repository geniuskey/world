-- Land ownership v2: territory is permanent. The active season becomes a world that never ends.
-- statement
UPDATE seasons SET ends_at=253402300799,rules_version='land-v2' WHERE status='active';
