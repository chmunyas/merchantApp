-- White-label foundation: reseller organizations (e.g. a bank) + per-tenant
-- branding (merchant logo / colors). Additive and idempotent.

-- A reseller organization that resells the app to its own merchants. A bank
-- signs up once, gets a slug (e.g. /r/acme-bank), its own brand, and can
-- onboard merchants under it. NULL org = direct / self-serve merchant.
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  -- { logoUrl, primaryColor, poweredBy, defaultMerchantBranding: {...} }
  branding    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Optional shared PesaSwap settlement context for the reseller's merchants.
  pesaswap_partner_id TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link a venue (merchant) to its reseller org.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_venues_org ON venues(org_id);

-- Reseller admins/staff are app_users scoped to an org rather than a venue.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_app_users_org ON app_users(org_id);

-- Per-venue (merchant) branding shown in the PWA + back office + public pages.
CREATE TABLE IF NOT EXISTS venue_branding (
  venue_id      TEXT PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  business_name TEXT,
  logo_url      TEXT,          -- data: URL (uploaded) or https URL
  primary_color TEXT,          -- hex, e.g. #2563eb
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
