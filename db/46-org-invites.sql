-- Reseller invite-token signup. An org can require an invite token (invite-only)
-- instead of open ?org=slug signup. Each token is single-use, optionally
-- email-bound, and expiring. Additive + idempotent.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS require_invite BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS org_invites (
  token      TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email      TEXT,
  used_at    TIMESTAMPTZ,
  used_venue TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_invites_org_idx ON org_invites (org_id);
