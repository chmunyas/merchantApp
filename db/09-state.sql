-- =====================================================================
-- Merchant state KV: mirrors the browser localStorage keys into Postgres
-- so the PWA and back office share one source of truth and sync across
-- devices. FULLY ADDITIVE + IDEMPOTENT.
-- =====================================================================
CREATE TABLE IF NOT EXISTS merchant_state (
  venue_id   text NOT NULL,
  skey       text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, skey)
);
