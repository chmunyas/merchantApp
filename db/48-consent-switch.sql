-- Cross-channel consent-to-switch audit. Records when a customer is contacted /
-- moved onto a channel (esp. a channel different from where they were last seen),
-- so there's a compliance trail for cross-channel outreach. Additive.
CREATE TABLE IF NOT EXISTS consent_switch_log (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT NOT NULL,
  handle       TEXT NOT NULL,
  channel      TEXT NOT NULL,
  from_channel TEXT,
  kind         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_switch_log_venue_idx
  ON consent_switch_log (venue_id, created_at DESC);
