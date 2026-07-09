-- Reseller revenue share. commission_bps is the reseller's cut of their
-- merchants' processed volume, in basis points (100 bps = 1%). Additive and
-- idempotent -- existing orgs default to 1%, which the portal shows as earned
-- commission and a settlement/revenue-share ledger can later post against.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS commission_bps INT NOT NULL DEFAULT 100;
