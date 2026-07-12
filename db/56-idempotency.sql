-- Durable idempotency for payment creation: a replayed create (offline sync, a
-- lost 200, a double-tap, a cross-isolate retry) returns the SAME result instead
-- of double-recording. The key is reserved atomically (first writer wins) and its
-- response is filled in on completion, so concurrent duplicates converge.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        text PRIMARY KEY,
  response   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);
