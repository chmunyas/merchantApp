-- =====================================================================
-- Idempotent invoice publishing.
--
-- Client-side (MerchantApp / pesaswapApp) invoices live only in the browser,
-- so their share links previously pointed at /merchant?pay=<id> — the operator
-- app, which a customer can neither view nor pay. On share we now persist the
-- invoice to Postgres using its client id as the invoice `number`, so the
-- shared /pay?i=<number> link (and its QR) resolve to a real, payable page.
--
-- A stable (venue_id, number) key makes that publish an idempotent UPSERT.
-- Additive + safe to re-run.
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS invoices_venue_number_uidx
  ON invoices (venue_id, number);
