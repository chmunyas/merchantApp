-- Phase 2 authenticated push-device binding.
-- Each subscription receives a random opaque device token stored only as a hash;
-- the service worker uses it to fetch that device's venue-bound notification.

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS device_token_hash TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS principal_sub TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS staff_id UUID;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing public subscriptions are not trustworthy. Remove them; users must
-- re-enable notifications from an authenticated session.
DELETE FROM push_subscriptions WHERE device_token_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_device_token_hash_key
  ON push_subscriptions (device_token_hash)
  WHERE device_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS push_subscriptions_principal_idx
  ON push_subscriptions (venue_id, principal_sub)
  WHERE device_token_hash IS NOT NULL;
