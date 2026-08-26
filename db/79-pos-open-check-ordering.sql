-- POS open-check ordering performance.
-- The floor/check list filters a venue's open checks and orders by newest opened
-- check. The table-scoped open-check index supports table lookup but leaves a
-- sort for the venue-wide list; this partial index satisfies both predicates.

CREATE INDEX IF NOT EXISTS pos_checks_venue_opened_open_idx
  ON pos_checks (venue_id, opened_at DESC NULLS LAST)
  WHERE closed_at IS NULL;
