-- =====================================================================
-- Accounting-grade invoicing: line items, tax, due dates, payments,
-- reminders, recurring schedules, and a per-invoice audit/comms log.
-- FULLY ADDITIVE + IDEMPOTENT.
-- =====================================================================

-- 1. Extend the invoices table.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal numeric;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_count int NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring_id uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes text;

-- 2. Recurring invoice schedules (subscriptions / retainers).
CREATE TABLE IF NOT EXISTS recurring_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       text NOT NULL,
  customer_name  text,
  phone          text,
  channel        text NOT NULL DEFAULT 'whatsapp',
  amount         numeric NOT NULL,
  currency       text NOT NULL DEFAULT 'KES',
  description    text,
  cadence        text NOT NULL DEFAULT 'monthly',   -- weekly | monthly
  next_run_at    timestamptz NOT NULL DEFAULT now(),
  due_days       int NOT NULL DEFAULT 7,
  active         boolean NOT NULL DEFAULT true,
  auto_send      boolean NOT NULL DEFAULT true,
  reminders      boolean NOT NULL DEFAULT true,
  last_run_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_due_idx
  ON recurring_invoices (venue_id, active, next_run_at);

-- 3. Per-invoice activity log (audit trail + delivery/comms tracking).
CREATE TABLE IF NOT EXISTS invoice_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid,
  venue_id   text NOT NULL,
  type       text NOT NULL,   -- created | sent | reminder | payment | paid | void
  detail     text,
  amount     numeric,
  channel    text,
  delivery   text,            -- sent | simulated | failed | pull
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_events_invoice_idx
  ON invoice_events (invoice_id, created_at);
CREATE INDEX IF NOT EXISTS invoice_events_venue_idx
  ON invoice_events (venue_id, created_at DESC);
