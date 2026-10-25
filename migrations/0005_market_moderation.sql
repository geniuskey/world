-- Do not let a stale public listing bypass a seller restriction.
-- statement
CREATE TRIGGER market_seller_active BEFORE INSERT ON actions WHEN NEW.type='buy' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM market_orders o JOIN users u ON u.id=o.seller_user_id WHERE o.id=json_extract(NEW.payload_json,'$.order_id') AND u.status<>'active') THEN RAISE(ABORT,'ORDER_UNAVAILABLE') END;
END;
