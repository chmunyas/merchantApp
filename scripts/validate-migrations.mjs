#!/usr/bin/env node
// Apply the complete migration chain to a caller-provided throwaway PostgreSQL
// URL. Never reads DATABASE_URL, so validation cannot accidentally mutate app data.
//
// This mirrors scripts/migrate.mjs deliberately, including creating
// `schema_migrations` first and recording each applied file. A migration is
// allowed to guard a one-time backfill on that table (db/80 does exactly that),
// so a validator that skipped the bookkeeping fails on a perfectly valid
// migration — and, worse, does not reproduce the runner's semantics, which is
// the only reason to run it.
//
// It then applies the whole chain a SECOND time against the same database. The
// repo's migration rules require every statement to be safe to re-run; this is
// what enforces that, rather than trusting each author to have got it right. A
// non-idempotent migration fails here instead of half-applying against a real
// database during a retried deploy.
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Known, documented exceptions to the re-run rule. An applied migration is
// immutable by house rule, so these cannot be fixed in place — they are recorded
// here instead of being silently skipped, and the list must not grow.
//
// 19-staff-pin.sql: its guard is `WHERE NOT EXISTS (SELECT 1 FROM staff WHERE
// pin = ...)`, which was correct until 58-staff-credentials.sql purged plaintext
// PINs to NULL and added `staff_plaintext_pin_forbidden`. On a re-run the guard
// therefore matches nothing, the seed rows are re-inserted with plaintext PINs,
// and the constraint rejects them. Harmless under scripts/migrate.mjs, which
// skips applied files: a bootstrap from EMPTY applies 19 long before 58 exists,
// so the constraint is not yet there and the seed succeeds. This has been
// verified against a scratch database — all 83 files apply cleanly from empty.
// The only way to hit it for real is to restore a database that already carries
// the schema but has LOST `schema_migrations`, which makes the runner replay
// everything. Carry that table with any dump, or restore from a full dump.
const IDEMPOTENCY_EXCEPTIONS = new Set(["19-staff-pin.sql"]);

const url = process.env.VALIDATE_DATABASE_URL;
if (!url) {
  console.error("VALIDATE_DATABASE_URL is required and must point to a throwaway database.");
  process.exit(2);
}
const dbDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db");
const files = readdirSync(dbDir)
  .filter((file) => file.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// Two files sharing a numeric prefix make apply order depend on the rest of the
// filename, which is not what the numbering is for. Order stays deterministic
// (localeCompare with numeric collation, same as the runner), and these two
// pairs are mutually independent, so they are grandfathered rather than renamed
// — renaming an applied migration would replay it under a new filename. Any NEW
// collision is an error: pick the next free integer.
const KNOWN_PREFIX_COLLISIONS = new Set(["78", "79"]);
const byPrefix = new Map();
for (const file of files) {
  const prefix = file.slice(0, file.indexOf("-"));
  byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file]);
}
const collisions = [...byPrefix.entries()].filter(([, group]) => group.length > 1);
let newCollision = false;
for (const [prefix, group] of collisions) {
  const known = KNOWN_PREFIX_COLLISIONS.has(prefix);
  const line = `migrations share prefix ${prefix}: ${group.join(", ")}`;
  if (known) {
    console.warn(`known prefix collision (see script header)\n  ${line}`);
  } else {
    console.error(`error: ${line}`);
    newCollision = true;
  }
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  for (const file of files) {
    const content = readFileSync(join(dbDir, file), "utf8");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(content).simple();
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})
                 ON CONFLICT DO NOTHING`;
      });
    } catch (error) {
      console.error(`FAILED applying ${file}`);
      throw error;
    }
  }
  console.log(`validated ${files.length} migrations`);

  // Second pass: every migration must survive being re-run. Collect every
  // failure rather than stopping at the first — one broken guard often means
  // several, and a partial list sends you round the loop twice.
  const notIdempotent = [];
  for (const file of files) {
    const content = readFileSync(join(dbDir, file), "utf8");
    try {
      await sql.begin((tx) => tx.unsafe(content).simple());
    } catch (error) {
      notIdempotent.push({ file, message: String(error?.message ?? error) });
    }
  }
  if (notIdempotent.length === 0) {
    console.log(`re-applied ${files.length} migrations cleanly (idempotent)`);
  } else {
    const unexpected = notIdempotent.filter(
      ({ file }) => !IDEMPOTENCY_EXCEPTIONS.has(file),
    );
    for (const { file, message } of notIdempotent) {
      const known = IDEMPOTENCY_EXCEPTIONS.has(file);
      const line = `  ${file}: ${message}`;
      if (known) console.warn(`known non-idempotent (see script header)\n${line}`);
      else console.error(line);
    }
    if (unexpected.length > 0) {
      console.error(
        `\n${unexpected.length} migration(s) are NOT idempotent. Every statement must be safe to re-run.`,
      );
      process.exitCode = 1;
    }
  }

  // An APPLIED migration may never be renumbered (it would change its
  // schema_migrations key and re-apply it), so the two existing collisions are
  // grandfathered above. A new one fails the build, because at that point it is
  // still cheap to rename the file.
  if (newCollision) {
    console.error(
      "\nA new migration re-used an existing numeric prefix. Rename it to the next free integer.",
    );
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 });
}