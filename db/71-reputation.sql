-- Reputation loop (roadmap D6): where a guest's rating goes after they give it,
-- which Google Business Profile a venue is connected to, and the reply-template
-- library used to answer reviews quickly.
--
-- Additive + idempotent. Nothing is deleted or backfilled: a venue with no
-- `review_settings` row falls back to the code defaults (Google redirect at 4+
-- stars, Google NOT connected), so existing venues behave exactly as before
-- until an operator opts in.
--
-- Deliberately absent: OAuth client id/secret and the Google refresh token.
-- Those are provider credentials and live in environment secrets only. This
-- table stores public Google identifiers (place id, account/location resource
-- names) and the venue's own routing preference.

CREATE TABLE IF NOT EXISTS review_settings (
  venue_id                   TEXT PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  -- A rating >= this is routed to the public Google review form; anything below
  -- is kept private and raises a staff alert instead. A venue setting, not a
  -- hardcoded moral judgement.
  public_redirect_min_rating SMALLINT NOT NULL DEFAULT 4
    CHECK (public_redirect_min_rating BETWEEN 1 AND 5),
  public_redirect_enabled    BOOLEAN NOT NULL DEFAULT true,
  google_place_id            TEXT,
  google_account_name        TEXT,
  google_location_name       TEXT,
  google_location_title      TEXT,
  google_connected_at        TIMESTAMPTZ,
  google_connected_by        TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_settings_venue_idx ON review_settings (venue_id);

-- Reply templates (D6.6). Sunday's placeholders are @customer_name@ and
-- @venue_name@; substitution happens in application code.
CREATE TABLE IF NOT EXISTS review_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_templates_venue_idx
  ON review_templates (venue_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS review_templates_venue_title_idx
  ON review_templates (venue_id, lower(title));

-- Provenance + Google linkage on the existing reviews table. `source` already
-- distinguishes where a rating was captured ('pay' | 'qr' | 'table' | 'app' |
-- 'google'); these columns record what happened to it afterwards.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS google_review_id     TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS redirected_to_google BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS redirected_at        TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_synced_at   TIMESTAMPTZ;

-- One local row per imported Google review, so a re-sync updates instead of
-- duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_venue_google_id_idx
  ON reviews (venue_id, google_review_id) WHERE google_review_id IS NOT NULL;

-- Per-server attribution reads (D6.9 -> D4 staff performance).
CREATE INDEX IF NOT EXISTS reviews_venue_staff_idx
  ON reviews (venue_id, staff_id) WHERE staff_id IS NOT NULL;
