-- Unified QR codes for browse, order, pay, loyalty, and receipt journeys.
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS qr_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  label      text,
  table_id   uuid,
  kind       text DEFAULT 'venue',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qr_codes_venue ON qr_codes (venue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qr_scans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id    uuid,
  venue_id   text,
  scanned_at timestamptz DEFAULT now(),
  user_agent text,
  amount     bigint
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_code ON qr_scans (code_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_scans_venue ON qr_scans (venue_id, scanned_at DESC);
