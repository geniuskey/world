-- Retire the original hand-picked pilot regions. Keep account history and assets.
-- New settlement is allocated only through the global world grid.
-- statement
UPDATE regions SET status='archived' WHERE id IN ('han','tagus','lakes');
