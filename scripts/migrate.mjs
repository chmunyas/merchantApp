#!/usr/bin/env node
// Apply any db/*.sql migrations not yet recorded in `schema_migrations` to the
// target Postgres, in filename order. Idempotent + safe to run on every deploy —
// each file runs at most once per database. Used by CI to keep the PRODUCTION and
// SANDBOX Neon databases in sync with the committed migrations.
//
//   MIGRATE_DATABASE_URL   the target database (required; a no-op if unset so CI
//                          stays green until the secret is configured)
//   MIGRATE_LABEL          a short label for the logs (e.g. "production")
//
// New databases: run once against a fresh DB to apply everything. Existing
// databases already carrying the schema should be back-filled first (record the
// already-applied filenames in schema_migrations) so nothing is re-run.
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.MIGRATE_DATABASE_URL;
const label = process.env.MIGRATE_LABEL || "database";
if (!url) {
  console.log(`[${label}] MIGRATE_DATABASE_URL not set — skipping migrations.`);
  process.exit(0);
}

const dbDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db");
const files = readdirSync(dbDir)
  .filter((f) => f.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const sql = postgres(url, {
  max: 1,
  // Neon (and other managed hosts) require TLS; a local Postgres (CI, dev,
  // prod-local) has none. Use SSL only when the URL asks for it.
  ssl: /sslmode=require|neon\.tech/i.test(url) ? "require" : false,
  connect_timeout: 30,
  idle_timeout: 10,
  onnotice: () => {},
});

let applied = 0;
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const done = new Set(
    (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename),
  );
  for (const f of files) {
    if (done.has(f)) continue;
    const content = readFileSync(join(dbDir, f), "utf8");
    process.stdout.write(`[${label}] applying ${f} ... `);
    // Server-side multi-statement parse (safer than a client-side ; splitter).
    await sql.unsafe(content).simple();
    await sql`INSERT INTO schema_migrations (filename) VALUES (${f})
              ON CONFLICT DO NOTHING`;
    console.log("ok");
    applied += 1;
  }
  console.log(
    `[${label}] done — ${applied} newly applied, ${files.length} total migrations.`,
  );
} catch (err) {
  console.error(`[${label}] migration FAILED:`, err?.message || err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
