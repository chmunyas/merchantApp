-- Phase 2 customer portal credential hardening.
-- Existing phone-only, plaintext, non-expiring bearer links are revoked and
-- scrubbed. New links store only a SHA-256 hash, expire, rotate, and can revoke.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE portal_tokens
SET token_hash = encode(digest(convert_to(token, 'UTF8'), 'sha256'), 'hex'),
    verified_at = NULL,
    expires_at = now(),
    revoked_at = COALESCE(revoked_at, now()),
    token = 'legacy_' || replace(gen_random_uuid()::text, '-', '')
WHERE token_hash IS NULL;

ALTER TABLE portal_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');

CREATE UNIQUE INDEX IF NOT EXISTS portal_tokens_hash_key
  ON portal_tokens (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS portal_tokens_one_active_subject_key
  ON portal_tokens (venue_id, phone)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS portal_tokens_active_expiry_idx
  ON portal_tokens (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN portal_tokens.token IS
  'Internal row id only; never stores portal bearer plaintext after migration 59';
COMMENT ON COLUMN portal_tokens.token_hash IS
  'SHA-256 hex of the random 256-bit portal bearer token. Ensure pgcrypto is enabled for this installation.';
