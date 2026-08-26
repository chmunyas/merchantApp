-- Phase 1 API-token hardening.
-- 1) Replace the legacy universal `agent` scope with entry-only `agent:invoke`.
-- 2) Bind tokens to an immutable creator user id so authorization does not rely
--    on an email-shaped subject.
-- 3) Revoke orphaned tokens whose creator no longer belongs to the token venue.

ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;

UPDATE api_tokens t
SET created_by_user_id = u.id
FROM app_users u
WHERE t.created_by_user_id IS NULL
  AND t.created_by IS NOT NULL
  AND lower(u.email) = lower(t.created_by);

UPDATE api_tokens
SET scopes = array_replace(scopes, 'agent', 'agent:invoke')
WHERE scopes @> ARRAY['agent']::text[];

UPDATE api_tokens t
SET revoked_at = COALESCE(t.revoked_at, now())
WHERE t.revoked_at IS NULL
  AND (
    t.venue_id IS NULL
    OR t.created_by_user_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM user_venues uv
      WHERE uv.user_id = t.created_by_user_id
        AND uv.venue_id = t.venue_id
    )
  );

CREATE INDEX IF NOT EXISTS api_tokens_creator_idx
  ON api_tokens (created_by_user_id)
  WHERE revoked_at IS NULL;