-- Multi-store: a user can own/manage MORE than one venue. `app_users.venue_id`
-- stays as the primary/default venue (non-breaking); this membership table is the
-- many-to-many that lets one login switch between several stores, each isolated.
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS user_venues (
  user_id    UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  venue_id   TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'merchant',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, venue_id)
);
CREATE INDEX IF NOT EXISTS user_venues_venue_idx ON user_venues (venue_id);

-- Backfill: every existing user is a member of their current venue, so multi-store
-- switching + the picker work for accounts created before this migration.
INSERT INTO user_venues (user_id, venue_id, role)
SELECT id, venue_id, role FROM app_users WHERE venue_id IS NOT NULL
ON CONFLICT DO NOTHING;
