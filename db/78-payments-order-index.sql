-- Index the order↔payment relationship the whole money path depends on.
--
-- `payments.metadata->>'order_id'` is used as a filter or a JOIN key in thirteen
-- places across seven modules — the split-payment balance check, the guest pay
-- page, the order and walkout consumers, the table payment list. Until now the
-- `payments` table carried exactly one index, `(venue_id, created_at DESC)`,
-- which none of those queries can use. Every one of them was a sequential scan.
--
-- The worst case is `src/lib/split-lock.ts`, which computes the outstanding
-- balance INSIDE a transaction holding `FOR UPDATE` on the order row: a scan
-- while holding a lock, on the checkout path, serialising concurrent split
-- payers behind each other and getting slower with every payment ever taken.
--
-- Two indexes, because the callers split into two shapes:
--   * venue-scoped lookups (the correct, tenant-filtered form)
--   * lookups keyed on the order id alone, from paths that hold an order id but
--     no venue (the balance clamp, the invoice/pay-link fallbacks)
-- Both are partial: a payment with no `order_id` in its metadata — a pay link,
-- an invoice, a Tap & Go sale — is never searched this way, so it does not
-- belong in the index.
--
-- This is a corrective index, not a schema change: nothing is added, dropped,
-- backfilled or defaulted, and no application behaviour changes. It is safe to
-- apply to a live database, though on a large `payments` table the build will
-- hold a lock for its duration — use CONCURRENTLY by hand if that matters (it
-- cannot be scripted here, because CREATE INDEX CONCURRENTLY may not run inside
-- the migration runner's transaction).
--
-- LONGER TERM: this relationship belongs in a real `payments.order_id` column
-- with a foreign key, not in a JSONB blob. That is a data migration with a
-- backfill and a dual-write window, so it is deliberately NOT bundled here.

CREATE INDEX IF NOT EXISTS payments_order_id_idx
  ON payments ((metadata->>'order_id'))
  WHERE metadata->>'order_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_venue_order_id_idx
  ON payments (venue_id, (metadata->>'order_id'))
  WHERE metadata->>'order_id' IS NOT NULL;
