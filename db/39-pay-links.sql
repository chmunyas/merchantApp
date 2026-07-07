-- =====================================================================
-- Server-bound payment requests ("pay links"). A short, unguessable token
-- resolves to an authoritative amount so ad-hoc / Tap&Go / booking-deposit /
-- split requests can be sent over any channel (WhatsApp/Telegram/SMS) WITHOUT
-- trusting the amount from the URL. Mirrors the QR order pay-token pattern.
-- Additive + idempotent.
-- =====================================================================
CREATE TABLE IF NOT EXISTS pay_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text NOT NULL UNIQUE,           -- opaque 256-bit URL token
  venue_id      text NOT NULL,
  amount        bigint NOT NULL,                 -- MINOR units (cents)
  currency      text NOT NULL DEFAULT 'KES',
  description   text,
  kind          text NOT NULL DEFAULT 'request', -- request | tapgo | deposit | split | booking
  reference     text,                            -- e.g. booking id / order id
  customer_phone text,
  customer_name text,
  status        text NOT NULL DEFAULT 'pending', -- pending | paid | expired | cancelled
  created_by    text,                            -- staff id / 'agent' / 'merchant'
  payment_id    text,                            -- the settling payment (once paid)
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  paid_at       timestamptz
);
CREATE INDEX IF NOT EXISTS pay_links_venue_idx ON pay_links (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pay_links_status_idx ON pay_links (venue_id, status);
CREATE INDEX IF NOT EXISTS pay_links_phone_idx ON pay_links (customer_phone);
