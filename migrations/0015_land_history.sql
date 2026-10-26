-- Land ownership v2 phase 4: owners see land they sold or lost since they last looked.
-- statement
ALTER TABLE profiles ADD COLUMN land_seen_at INTEGER NOT NULL DEFAULT 0;
-- statement
CREATE INDEX land_trade_seller ON land_trades(seller_user_id,created_at DESC);
