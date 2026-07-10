-- Passwordless-first auth: single-use OTP codes (email / WhatsApp / SMS) + optional
-- TOTP 2FA. Codes are HASHED, attempt-capped and expiring. password_hash becomes
-- OPTIONAL so an account can exist with no password (OTP-only), and can later
-- "upgrade" to password + TOTP for higher assurance. Additive + idempotent.
CREATE TABLE IF NOT EXISTS auth_otps (
  id           TEXT PRIMARY KEY,
  channel      TEXT NOT NULL,               -- email | whatsapp | sms
  destination  TEXT NOT NULL,               -- lower(email) or +2547…
  code_hash    TEXT NOT NULL,
  purpose      TEXT NOT NULL DEFAULT 'login',
  attempts     INT  NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_otps_dest_idx ON auth_otps (destination, created_at DESC);

-- Optional authenticator-app (TOTP) 2FA. Secret is set at enrolment, enabled only
-- after the user proves a valid code.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS totp_secret  TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone        TEXT;

-- Passwordless accounts have no password_hash.
ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;
