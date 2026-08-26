---
applyTo: "db/*.sql"
description: "Rules for database migrations: forward-only numbering, idempotency, tenancy columns, and the operator follow-up note."
---

# Migration rules

Migrations are applied by [scripts/migrate.mjs](../../scripts/migrate.mjs) in numeric filename
order, each recorded once in `schema_migrations`. A file that has run on any environment is
**immutable**.

## 1. Numbering and naming

- Next free integer, zero-padded to two digits, then a kebab-case subject:
  `db/61-pos-connections.sql`.
- One migration per coherent change. Do not batch unrelated schema work into one file.
- Never renumber, rename, edit or delete an existing migration. Corrections ship as a new file.

## 2. Idempotency

Every statement must be safe to re-run against a partially-applied database:

```sql
CREATE TABLE IF NOT EXISTS ...
ALTER TABLE x ADD COLUMN IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE <partial predicate>
```

The file is executed as a single server-side multi-statement batch — no client-side `;` splitting,
so `DO $$ ... $$` blocks and functions are fine.

## 3. Header comment

Open every file with a short comment stating the purpose and any behavioural consequence
(especially destructive ones), matching the existing house style:

```sql
-- <What this enables, in one line.>
-- <Why any data is deleted / defaulted / backfilled, if applicable.>
```

## 4. Tenancy and shape

- Every business table carries `venue_id UUID NOT NULL` and is indexed on it, leading.
- Timestamps are `TIMESTAMPTZ NOT NULL DEFAULT now()` — `created_at`, and `updated_at` where rows mutate.
- Money is stored in minor units as integers. Never floats.
- Store secrets and tokens as hashes only; index the hash, not the plaintext.
- Prefer additive change. When a column must be retired, stop writing it first, drop it in a
  later migration.

## 5. Destructive statements

`DELETE`, `DROP`, `UPDATE` without a narrow predicate, and NOT-NULL backfills need an explicit
justification in the header comment and a stated recovery position. If untrusted rows must be
purged (as in `db/60`), say so and say what the user must do to restore service.

## 6. After writing the migration

- Note it in [BACKLOG.md](../../BACKLOG.md) as an operator action: *"apply migration NN before
  deploying X"*. Committing SQL is not applying it.
- Update the reading code in the same change so a fresh database and a migrated database behave
  identically.
- Run `npm run lint && npm run build`.
