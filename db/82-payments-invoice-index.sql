-- Index the payments→invoice link used by every settlement.
--
-- `reconcileInvoiceBalance()` derives an invoice's paid amount by summing the
-- payments whose metadata points at it:
--
--   WHERE venue_id = $1 AND metadata->>'invoice_number' = $2
--
-- There was no index for that expression, so every invoice settlement scanned
-- the whole payments table for the venue. Orders already have the equivalent
-- index (`payments_venue_order_id_idx`); invoices were simply missed.
--
-- Partial, because only invoice-originated payments carry the key.

CREATE INDEX IF NOT EXISTS payments_venue_invoice_number_idx
  ON payments (venue_id, ((metadata ->> 'invoice_number')))
  WHERE (metadata ->> 'invoice_number') IS NOT NULL;
