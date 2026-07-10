-- Enterprise OIDC single sign-on, per reseller ORG: a bank/enterprise connects its
-- own IdP (Okta, Entra ID, Google Workspace, Auth0…) and its people sign in with
-- corporate credentials. One connection per org. Secrets live server-side only.
CREATE TABLE IF NOT EXISTS sso_connections (
  org_id         TEXT PRIMARY KEY,
  provider       TEXT NOT NULL DEFAULT 'oidc',
  issuer         TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  client_secret  TEXT NOT NULL,
  authorize_url  TEXT NOT NULL,
  token_url      TEXT NOT NULL,
  jwks_url       TEXT NOT NULL,
  email_domain   TEXT,                       -- restrict logins to @company.com
  default_role   TEXT NOT NULL DEFAULT 'reseller_admin',
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short-lived login states (CSRF + nonce) for the OIDC authorization-code flow.
CREATE TABLE IF NOT EXISTS sso_states (
  state        TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  nonce        TEXT NOT NULL,
  redirect_to  TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
