-- Phase 7 optimistic state concurrency and venue-local time semantics.

ALTER TABLE merchant_state
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi';

ALTER TABLE venues
  DROP CONSTRAINT IF EXISTS venues_timezone_valid;
ALTER TABLE venues
  ADD CONSTRAINT venues_timezone_valid
  CHECK (timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+)+$');

UPDATE venues SET timezone = 'Africa/Nairobi'
WHERE timezone IS NULL OR timezone = '';

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();