-- WhatsApp channel + AI agent persistence (PostgreSQL).
CREATE TABLE IF NOT EXISTS wa_allowlist (
  phone      TEXT PRIMARY KEY,
  venue_id   TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'staff', -- staff | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  wa_id           TEXT NOT NULL,                    -- customer / staff phone
  name            TEXT,
  role            TEXT NOT NULL DEFAULT 'customer', -- customer | staff | admin
  status          TEXT NOT NULL DEFAULT 'open',     -- open | escalated | closed
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, wa_id)
);
CREATE INDEX IF NOT EXISTS conversations_venue_idx
  ON conversations (venue_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL,   -- inbound | outbound
  body            TEXT NOT NULL,
  ai              BOOLEAN NOT NULL DEFAULT false,
  tool            TEXT,            -- agent tool used, if any
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages (conversation_id, created_at);

-- Seed one allowlisted staff number so admin AI control is demonstrable.
INSERT INTO wa_allowlist (phone, venue_id, name, role) VALUES
  ('+254700000001', 'main', 'Grace (Manager)', 'admin')
ON CONFLICT (phone) DO NOTHING;
