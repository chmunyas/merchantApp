-- =====================================================================
-- P0 Omnichannel foundation. FULLY ADDITIVE + IDEMPOTENT.
-- Safe to run on an existing database: no drops, no data changes, and
-- every existing row keeps working (channel defaults to 'whatsapp').
-- =====================================================================

-- 1. Channel awareness on the existing conversation/message tables.
--    conversations.wa_id holds the channel-native handle:
--      whatsapp -> '+2547...'  |  web -> 'web:<sessionId>'  |  telegram -> 'tg:<id>'
--    The existing UNIQUE(venue_id, wa_id) still holds because handles do not
--    collide across channels, so processInbound's ON CONFLICT stays valid.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS person_id uuid;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel text;

-- 2. Identity graph — one Person, many channel identities (Omni pattern).
CREATE TABLE IF NOT EXISTS persons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text NOT NULL,
  display_name  text,
  primary_phone text,
  primary_email text,
  avatar_url    text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS persons_venue_phone_idx ON persons (venue_id, primary_phone);

CREATE TABLE IF NOT EXISTS platform_identities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id        uuid REFERENCES persons(id) ON DELETE CASCADE,
  venue_id         text NOT NULL,
  channel          text NOT NULL,
  platform_user_id text NOT NULL,
  confidence       real NOT NULL DEFAULT 1.0,
  linked_by        text NOT NULL DEFAULT 'initial',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, channel, platform_user_id)
);

-- 3. Durable event log + inbound dedupe (Omni JetStream pattern, on Postgres).
CREATE TABLE IF NOT EXISTS events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        text NOT NULL,
  channel         text NOT NULL,
  direction       text NOT NULL,
  provider_msg_id text,
  conversation_id uuid,
  type            text NOT NULL DEFAULT 'message',
  status          text NOT NULL DEFAULT 'received',
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- A provider message id is unique per channel (only enforced when present),
-- so a retried webhook delivery is silently ignored.
CREATE UNIQUE INDEX IF NOT EXISTS events_provider_dedupe
  ON events (channel, provider_msg_id) WHERE provider_msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_venue_created_idx ON events (venue_id, created_at DESC);

-- 4. Web Push subscriptions (for PWA notifications).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  audience   text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Key/value app settings (e.g. runtime-generated VAPID keypair).
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
