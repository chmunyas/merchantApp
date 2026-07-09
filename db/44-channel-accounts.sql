-- Venue-aware inbound routing. Maps an inbound channel account (a WhatsApp
-- phone_number_id, a Telegram bot id/username, an SMS destination number or an
-- inbound email address) to the venue that owns it, so a customer messaging
-- store A's number reaches store A's agent, menu and orders. Additive and
-- idempotent -- when no row matches, inbound falls back to the default venue
-- ("main"), preserving single-venue behaviour.
CREATE TABLE IF NOT EXISTS channel_accounts (
  channel    TEXT NOT NULL,
  account_id TEXT NOT NULL,
  venue_id   TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, account_id)
);
CREATE INDEX IF NOT EXISTS channel_accounts_venue_idx ON channel_accounts (venue_id);
