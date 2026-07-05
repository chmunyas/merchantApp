-- Server-authoritative team members. Replaces the merchant_state 'settings.users'
-- blob so two devices editing staff no longer clobber the whole array — each
-- staff member is its own row, scoped to a venue. Additive + idempotent.
CREATE TABLE IF NOT EXISTS staff (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'Server',
  phone      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_venue ON staff (venue_id);
