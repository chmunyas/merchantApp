-- =====================================================================
-- Invoices — omnichannel billing with a pay link. Additive + idempotent.
-- =====================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        text NOT NULL,
  number          text NOT NULL,
  customer_name   text,
  phone           text,
  amount          numeric NOT NULL,
  currency        text NOT NULL DEFAULT 'KES',
  description     text,
  status          text NOT NULL DEFAULT 'sent',   -- draft | sent | paid | void
  channel         text,
  conversation_id uuid,
  pay_link        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz
);
CREATE INDEX IF NOT EXISTS invoices_venue_status_idx ON invoices (venue_id, status);
