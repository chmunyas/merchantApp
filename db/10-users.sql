-- Self-serve merchant accounts. Each signup creates a venue (01-schema.sql) and
-- an app_users row scoped to it. The seeded platform admin still lives in
-- app_settings.auth; these are the tenants that onboard themselves.
CREATE TABLE IF NOT EXISTS app_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  phone         TEXT,
  venue_id      TEXT REFERENCES venues(id) ON DELETE SET NULL,
  role          TEXT NOT NULL DEFAULT 'merchant',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx ON app_users (lower(email));
