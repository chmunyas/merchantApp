-- Sunday-parity staff service notifications (roadmap B2).
-- Adds the per-staff table subscriptions a server taps at the start of a shift
-- (B2.13), their per-notification-type opt-in (B2.14), and the delivered
-- notification queue the service worker reads on a payloadless push tickle.
-- Additive + idempotent. No existing data is modified or removed.

-- 1. Table subscriptions. A server follows only the tables they are serving; a
-- table-scoped alert fires for those staff and nobody else. `table_key` is
-- `dining_tables.id` when the table is a floorplan row, otherwise the raw
-- reference carried by the order/payment. `table_label` is kept alongside so a
-- payment that only knows "12" still matches a followed floorplan table.
CREATE TABLE IF NOT EXISTS staff_table_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL,
  staff_id    UUID NOT NULL,
  table_key   TEXT NOT NULL,
  table_label TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_table_subscriptions_unique
  ON staff_table_subscriptions (venue_id, staff_id, table_key);
CREATE INDEX IF NOT EXISTS staff_table_subscriptions_venue_table_idx
  ON staff_table_subscriptions (venue_id, table_key);
CREATE INDEX IF NOT EXISTS staff_table_subscriptions_venue_staff_idx
  ON staff_table_subscriptions (venue_id, staff_id);

-- 2. Per-notification-type opt-in. Only explicit overrides are stored; an absent
-- row means the type's built-in default applies (see src/lib/staff-notifications.ts).
CREATE TABLE IF NOT EXISTS staff_notification_prefs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL,
  staff_id   UUID NOT NULL,
  type       TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_notification_prefs_unique
  ON staff_notification_prefs (venue_id, staff_id, type);

-- 3. The delivered queue. One row per recipient per event, so the service worker
-- can fetch the text for THIS device's staff member rather than a venue-wide
-- blob. `dedupe_key` makes a retried event (webhook redelivery, PATCH replay)
-- idempotent per recipient. Money is minor units.
CREATE TABLE IF NOT EXISTS staff_notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       TEXT NOT NULL,
  staff_id       UUID NOT NULL,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  table_key      TEXT,
  table_label    TEXT,
  amount_minor   BIGINT,
  remaining_minor BIGINT,
  currency       TEXT NOT NULL DEFAULT 'KES',
  url            TEXT,
  dedupe_key     TEXT,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_notifications_recipient_idx
  ON staff_notifications (venue_id, staff_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS staff_notifications_dedupe
  ON staff_notifications (venue_id, staff_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
