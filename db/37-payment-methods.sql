-- =====================================================================
-- Persisted customer payment methods, keyed by phone (the loyalty key), so
-- "retrieve my methods by phone" is DB-backed instead of in-memory. Additive.
-- =====================================================================
CREATE TABLE IF NOT EXISTS customer_payment_methods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     text,
  phone        text NOT NULL,
  kind         text NOT NULL DEFAULT 'mpesa',  -- mpesa | card | wallet
  label        text,
  is_default   boolean NOT NULL DEFAULT true,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cpm_phone_kind_idx ON customer_payment_methods (phone, kind);
CREATE INDEX IF NOT EXISTS cpm_phone_idx ON customer_payment_methods (phone);
