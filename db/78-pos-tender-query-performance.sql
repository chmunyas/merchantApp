-- POS tender operational-query performance.
-- The dashboard lists a venue's tender pushes, optionally filtered by status,
-- newest first. The existing partial unsynced index cannot serve the common
-- all-status and notified/manual views, so this composite index avoids a growing
-- sort/scan as payment volume rises. Additive and safe to apply online.

CREATE INDEX IF NOT EXISTS pos_tender_pushes_venue_status_created_idx
  ON pos_tender_pushes (venue_id, status, created_at DESC);
