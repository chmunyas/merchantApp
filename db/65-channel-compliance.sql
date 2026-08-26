-- Phase 6 channel trust, compliance, durable ingress and durable outbound work.

CREATE OR REPLACE FUNCTION reject_channel_fact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE channel_accounts ADD COLUMN IF NOT EXISTS ingress_key_hash TEXT;

-- Conversation identity includes the transport channel. Migrate handles to an
-- internal namespaced key so the legacy (venue_id, wa_id) uniqueness remains safe.
UPDATE conversations
SET wa_id = channel || ':' || wa_id
WHERE wa_id NOT LIKE channel || ':%'
;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_venue_channel_handle_key
  ON conversations (venue_id, channel, wa_id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ingress_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS messages_ingress_direction_key
  ON messages (ingress_id, direction)
  WHERE ingress_id IS NOT NULL;
ALTER TABLE pay_links ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pay_links_venue_idempotency_key
  ON pay_links (venue_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_venue_idempotency_key
  ON invoices (venue_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE invoice_communication_outbox
  DROP CONSTRAINT IF EXISTS invoice_communication_outbox_status_check;
ALTER TABLE invoice_communication_outbox
  ADD CONSTRAINT invoice_communication_outbox_status_check
  CHECK (status IN ('pending','processing','queued','accepted','failed'));

CREATE TABLE IF NOT EXISTS channel_consent_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  channel         TEXT NOT NULL,
  account_id      TEXT,
  handle          TEXT NOT NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('marketing','utility','transactional','authentication')),
  state           TEXT NOT NULL CHECK (state IN ('granted','withdrawn')),
  source          TEXT NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '{}',
  actor           TEXT,
  effective_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_consent_current_idx
  ON channel_consent_events (venue_id, channel, handle, purpose, effective_at DESC);

CREATE TABLE IF NOT EXISTS channel_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  channel         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  provider_template_id TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('marketing','utility','authentication')),
  locale          TEXT NOT NULL DEFAULT 'en',
  approved        BOOLEAN NOT NULL DEFAULT false,
  body            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, account_id, provider_template_id, locale)
);

CREATE TABLE IF NOT EXISTS channel_ingress_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  venue_id        TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  claim_token     UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (channel, account_id, provider_event_id)
);
CREATE INDEX IF NOT EXISTS channel_ingress_due_idx
  ON channel_ingress_events (next_attempt_at, created_at)
  WHERE status IN ('pending','failed','processing');

CREATE TABLE IF NOT EXISTS campaign_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('broadcast','sequence','share','reply','system')),
  idempotency_key TEXT NOT NULL,
  channel         TEXT NOT NULL,
  segment         TEXT,
  purpose         TEXT NOT NULL CHECK (purpose IN ('marketing','utility','transactional','authentication')),
  template_id     UUID REFERENCES channel_templates(id),
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','processing','completed','failed')),
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS outbound_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_key    TEXT NOT NULL UNIQUE,
  run_id          UUID REFERENCES campaign_runs(id),
  venue_id        TEXT NOT NULL,
  source_type     TEXT NOT NULL,
  source_id       TEXT,
  channel         TEXT NOT NULL,
  account_id      TEXT,
  handle          TEXT NOT NULL,
  recipient_name  TEXT,
  purpose         TEXT NOT NULL CHECK (purpose IN ('marketing','utility','transactional','authentication')),
  template_id     UUID REFERENCES channel_templates(id),
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','processing','accepted','delivered','read','failed','unknown','suppressed','deferred','simulated','pull')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_token     UUID,
  lease_expires_at TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  provider_message_id TEXT,
  provider_code   TEXT,
  last_error      TEXT,
  retryable       BOOLEAN NOT NULL DEFAULT true,
  accepted_at     TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  policy_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbound_deliveries_due_idx
  ON outbound_deliveries (next_attempt_at, created_at)
  WHERE status IN ('queued','failed','processing','deferred');
CREATE UNIQUE INDEX IF NOT EXISTS outbound_provider_message_key
  ON outbound_deliveries (channel, account_id, provider_message_id)
  WHERE account_id IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     UUID NOT NULL REFERENCES outbound_deliveries(id),
  attempt_no      INTEGER NOT NULL,
  state           TEXT NOT NULL,
  provider_message_id TEXT,
  provider_code   TEXT,
  error           TEXT,
  retryable       BOOLEAN NOT NULL DEFAULT false,
  response        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, attempt_no, state)
);

CREATE TABLE IF NOT EXISTS channel_delivery_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('delivered','read','failed')),
  provider_code   TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, account_id, provider_message_id, status)
);
CREATE INDEX IF NOT EXISTS channel_receipts_unapplied_idx
  ON channel_delivery_receipts (created_at) WHERE applied_at IS NULL;

DROP TRIGGER IF EXISTS channel_consent_events_append_only ON channel_consent_events;
CREATE TRIGGER channel_consent_events_append_only
  BEFORE UPDATE OR DELETE ON channel_consent_events
  FOR EACH ROW EXECUTE FUNCTION reject_channel_fact_mutation();

DROP TRIGGER IF EXISTS delivery_attempts_append_only ON delivery_attempts;
CREATE TRIGGER delivery_attempts_append_only
  BEFORE UPDATE OR DELETE ON delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_channel_fact_mutation();

ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS claim_token UUID;
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sequence_enrollments
    WHERE status = 'active'
    GROUP BY sequence_id, venue_id, handle HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'migration 65 preflight: duplicate active sequence enrollments require remediation';
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS sequence_enrollment_active_key
  ON sequence_enrollments (sequence_id, venue_id, handle)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS sequences_id_venue_key ON sequences (id, venue_id);

DROP INDEX IF EXISTS events_provider_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS events_provider_account_dedupe
  ON events (channel, (payload->>'account_id'), provider_msg_id)
  WHERE provider_msg_id IS NOT NULL AND payload->>'account_id' IS NOT NULL;
