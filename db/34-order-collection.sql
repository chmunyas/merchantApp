-- =====================================================================
-- Click & Collect: a collection time slot + fulfilment mode on orders, plus a
-- one-shot "order ready" notification stamp so the customer is told (once) when
-- their order transitions to `ready`. Additive + idempotent.
-- =====================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_at        timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilment       text;  -- dine_in | takeaway | collection
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_notified_at timestamptz;
