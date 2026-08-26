-- Make per-venue membership the revocable authority for dashboard sessions.
-- Existing memberships start at version 1; deploying code invalidates old venue
-- JWTs without this claim, so every dashboard user must sign in again once.

ALTER TABLE user_venues
  ADD COLUMN IF NOT EXISTS membership_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE user_venues
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE user_venues
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_venues_membership_version_positive'
      AND conrelid = 'user_venues'::regclass
  ) THEN
    ALTER TABLE user_venues
      ADD CONSTRAINT user_venues_membership_version_positive
      CHECK (membership_version > 0);
  END IF;
END
$constraints$;

CREATE OR REPLACE FUNCTION bump_venue_membership_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.membership_version := OLD.membership_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_venues_version_on_role_change ON user_venues;
CREATE TRIGGER user_venues_version_on_role_change
BEFORE UPDATE ON user_venues
FOR EACH ROW EXECUTE FUNCTION bump_venue_membership_version();

CREATE TABLE IF NOT EXISTS venue_membership_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id               TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  subject_email          TEXT NOT NULL,
  actor_sub              TEXT NOT NULL,
  actor_role             TEXT NOT NULL,
  action                 TEXT NOT NULL,
  prior_role             TEXT,
  next_role              TEXT,
  prior_version          BIGINT,
  next_version           BIGINT,
  correlation_id         UUID NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (action IN ('member_added', 'role_changed', 'member_removed')),
  CHECK (
    (action = 'member_added' AND prior_role IS NULL AND next_role IS NOT NULL) OR
    (action = 'role_changed' AND prior_role IS NOT NULL AND next_role IS NOT NULL) OR
    (action = 'member_removed' AND prior_role IS NOT NULL AND next_role IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS venue_membership_events_venue_created_idx
  ON venue_membership_events (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS venue_membership_events_subject_idx
  ON venue_membership_events (venue_id, user_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_membership_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'venue_membership_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS venue_membership_events_append_only
  ON venue_membership_events;
CREATE TRIGGER venue_membership_events_append_only
BEFORE UPDATE OR DELETE ON venue_membership_events
FOR EACH ROW EXECUTE FUNCTION reject_membership_event_mutation();