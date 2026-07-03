-- PesaSwap cloud backend schema (PostgreSQL 16 + pgvector).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS venues (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  tier        TEXT NOT NULL DEFAULT 'Bronze',
  points      INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC NOT NULL DEFAULT 0,
  visits      INTEGER NOT NULL DEFAULT 0,
  last_visit  TIMESTAMPTZ,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_venue_idx ON contacts (venue_id);

CREATE TABLE IF NOT EXISTS reservations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id       TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL,
  phone          TEXT,
  table_number   INTEGER,
  combination_id TEXT,
  covers         INTEGER NOT NULL,
  date           DATE NOT NULL,
  time           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed',
  deposit_amount NUMERIC,
  deposit_status TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservations_venue_date_idx ON reservations (venue_id, date);

CREATE TABLE IF NOT EXISTS enquiries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  phone         TEXT,
  covers        INTEGER NOT NULL,
  date          DATE NOT NULL,
  time          TEXT NOT NULL,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  source        TEXT NOT NULL DEFAULT 'web',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enquiries_venue_status_idx ON enquiries (venue_id, status);

-- Vector memory for the AI agent. 768 dims = Workers AI @cf/baai/bge-base-en-v1.5.
CREATE TABLE IF NOT EXISTS ai_memory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  embedding  vector(768),
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_memory_embedding_idx
  ON ai_memory USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS activity_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   TEXT,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
