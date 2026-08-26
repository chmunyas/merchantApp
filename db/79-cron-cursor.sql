-- Make the scheduled worker survive venue growth.
--
-- The cron handler used to loop over EVERY venue serially, three awaits deep.
-- That is O(venues) wall-clock inside a scheduled invocation with a fixed
-- budget: at a few thousand venues it cannot finish, and — worse — it fails
-- silently and asymmetrically. The venues sorted last by id simply never get
-- their tip cadence or walkout detection run, and nothing reports it.
--
-- This cursor makes each invocation process a BOUNDED slice and remember where
-- it stopped, so the next run continues from there and wraps around. Every venue
-- is serviced in round-robin instead of the first N always winning.
--
-- Additive + idempotent. An empty table means "start from the beginning", which
-- is the correct behaviour on first deploy.

CREATE TABLE IF NOT EXISTS cron_cursors (
  job           TEXT PRIMARY KEY,
  -- Exclusive lower bound: the last venue id this job finished.
  last_venue_id TEXT,
  -- Observability: how many full passes the job has completed.
  cycles        BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
