-- Vertical + tier productisation: what a venue IS and what it has PAID FOR.
--
-- Until now `MerchantVertical` existed only as a TypeScript union in the admin
-- console's localStorage, so every merchant saw every other vertical's features
-- and no plan limit was enforceable. This makes both facts server-side, which is
-- what lets navigation, API authorisation and billing agree on one answer.
--
-- BACKFILL NOTE: existing venues are set to `enterprise` deliberately. Today
-- every venue can reach every feature, so defaulting them to a lower tier would
-- silently REMOVE working functionality from live merchants. New venues start at
-- `starter`. Operators should set real tiers per venue before enforcing billing.

ALTER TABLE venues ADD COLUMN IF NOT EXISTS vertical TEXT NOT NULL DEFAULT 'restaurant';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'starter';

UPDATE venues SET vertical = 'hospitality' WHERE vertical = 'hospital';

ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_vertical_known;
ALTER TABLE venues ADD CONSTRAINT venues_vertical_known
  CHECK (vertical IN ('restaurant', 'retail', 'services', 'hospitality'));

ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_tier_known;
ALTER TABLE venues ADD CONSTRAINT venues_tier_known
  CHECK (tier IN ('free', 'starter', 'growth', 'enterprise'));

-- One-time, non-destructive: preserve today's behaviour for venues that already
-- exist. Guarded so re-running the migration never re-grants a downgraded venue.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '80-venue-vertical-capabilities.sql') THEN
    UPDATE venues SET tier = 'enterprise';
  END IF;
END;
$$;

-- Per-venue opt-in/opt-out on top of the vertical default. `enabled = false`
-- hides something the vertical includes; `enabled = true` adds something it does
-- not. Neither can escape the tier limit — that is enforced in src/lib/verticals.ts
-- so the server and the browser reach the same verdict from one rule.
CREATE TABLE IF NOT EXISTS venue_capability_overrides (
  venue_id   TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, capability)
);

CREATE INDEX IF NOT EXISTS venue_capability_overrides_venue_idx
  ON venue_capability_overrides (venue_id);

CREATE INDEX IF NOT EXISTS venues_vertical_idx ON venues (vertical) WHERE active;
