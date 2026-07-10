-- Personal / agent API tokens: long-lived, SCOPED, revocable bearer credentials an
-- agent uses to act on a user's behalf — decoupled from the interactive login
-- session. Only a SHA-256 hash of the token is stored (shown once at creation).
CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,
  venue_id      TEXT,                              -- tenant the token acts within
  org_id        TEXT,
  name          TEXT NOT NULL,
  token_prefix  TEXT NOT NULL,                     -- e.g. pat_ab12cd34 (for display)
  token_hash    TEXT NOT NULL,                     -- SHA-256 hex of the full token
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  role          TEXT NOT NULL DEFAULT 'staff',     -- effective role (capped at manager)
  created_by    TEXT,                              -- email of the human who minted it
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,                       -- optional
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens (token_hash);
CREATE INDEX IF NOT EXISTS api_tokens_venue_idx ON api_tokens (venue_id) WHERE revoked_at IS NULL;
