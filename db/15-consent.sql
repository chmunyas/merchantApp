-- Consent / suppression list for outbound compliance. A contact that sends STOP
-- (opt-out) on a channel is suppressed; START opts them back in. The inbound
-- pipeline checks this before any outbound send. Additive + idempotent.
CREATE TABLE IF NOT EXISTS suppressions (
  venue_id   TEXT NOT NULL,
  channel    TEXT NOT NULL,
  handle     TEXT NOT NULL,          -- phone / platform handle that opted out
  reason     TEXT NOT NULL DEFAULT 'user_request',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, channel, handle)
);
