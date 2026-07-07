-- =====================================================================
-- Phase 0 — agentic foundations.
--
-- 1) Agent Pay Gateway: tag every payment as human- or agent-initiated so
--    fraud/risk and reporting can treat the two flows differently.
-- 2) Verifiable Intent Framework: a tamper-evident record of an agent's signed
--    spending intent (HMAC-SHA256 over the canonical payload), so banks can
--    verify that a specific transaction matches a specific authorised intent.
-- Additive + idempotent.
-- =====================================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS initiator TEXT NOT NULL DEFAULT 'human'; -- human | agent
CREATE INDEX IF NOT EXISTS payments_venue_initiator_idx
  ON payments (venue_id, initiator);

CREATE TABLE IF NOT EXISTS agent_intents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  agent_ref  text,
  user_ref   text,
  merchant   text,
  amount     bigint NOT NULL DEFAULT 0,   -- the authorised ceiling (whole KES)
  currency   text NOT NULL DEFAULT 'KES',
  context    text,
  signature  text NOT NULL,               -- HMAC-SHA256(canonical payload)
  status     text NOT NULL DEFAULT 'created', -- created | fulfilled | expired
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_intents_venue_idx
  ON agent_intents (venue_id, created_at DESC);
