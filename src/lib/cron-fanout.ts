// Bounded, resumable fan-out for the scheduled worker.
//
// The problem this solves: a cron handler that loops over every venue serially
// is O(venues) wall-clock inside an invocation with a fixed budget. It does not
// degrade gracefully — it truncates, silently, always at the same end of the
// list, so the venues sorted last never get serviced at all.
//
// Two mechanisms:
//   * `mapWithConcurrency` — run a bounded number of venues at once instead of
//     one at a time. The bound matters: the Postgres client is capped at 5
//     connections, so unbounded parallelism would just queue inside the driver
//     while multiplying peak memory.
//   * a persisted cursor — process a bounded SLICE per invocation and remember
//     where it stopped. The next run continues from there and wraps. Every venue
//     is serviced in round-robin rather than the first N winning every time.
//
// With few venues a slice covers all of them and behaviour is unchanged.

import type { Sql } from "@/lib/db";

/**
 * Run `fn` over `items` with at most `limit` in flight. Results keep input
 * order. A rejection propagates — callers that must not fail the batch wrap
 * `fn` themselves (the scheduled handler does, via `safely`).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const bound = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(bound, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export type VenueSlice = {
  venueIds: string[];
  /** The cursor to persist once the slice has been processed. */
  nextCursor: string | null;
  /** True when this slice reached the end of the list and wrapped. */
  wrapped: boolean;
};

/**
 * The next bounded slice of venues after the job's cursor, wrapping at the end.
 *
 * Ordering is by `id` because it is the primary key: stable, indexed, and it
 * cannot drift under us the way a mutable column could. A venue created mid-pass
 * is simply picked up on the pass that reaches its id.
 */
export async function nextVenueSlice(
  sql: Sql,
  job: string,
  limit: number,
): Promise<VenueSlice> {
  const size = Math.max(1, Math.floor(limit));
  const [cursor] = await sql`
    SELECT last_venue_id FROM cron_cursors WHERE job = ${job} LIMIT 1`;
  const after = (cursor?.last_venue_id as string | null) ?? null;

  const rows = after
    ? await sql`
        SELECT id FROM venues WHERE id > ${after} ORDER BY id LIMIT ${size}`
    : await sql`SELECT id FROM venues ORDER BY id LIMIT ${size}`;

  let venueIds = rows.map((row) => String(row.id));
  let wrapped = false;

  // Ran off the end: wrap to the start so no venue waits a whole extra cycle.
  if (venueIds.length < size) {
    wrapped = true;
    const remaining = size - venueIds.length;
    const head = await sql`
      SELECT id FROM venues ORDER BY id LIMIT ${remaining}`;
    const seen = new Set(venueIds);
    for (const row of head) {
      const id = String(row.id);
      if (!seen.has(id)) {
        venueIds.push(id);
        seen.add(id);
      }
    }
    // A single wrap must not revisit ids we just did in this same slice.
    venueIds = venueIds.slice(0, size);
  }

  return {
    venueIds,
    nextCursor: wrapped ? null : (venueIds[venueIds.length - 1] ?? null),
    wrapped,
  };
}

export async function saveVenueCursor(
  sql: Sql,
  job: string,
  slice: VenueSlice,
): Promise<void> {
  await sql`
    INSERT INTO cron_cursors (job, last_venue_id, cycles, updated_at)
    VALUES (${job}, ${slice.nextCursor}, ${slice.wrapped ? 1 : 0}, now())
    ON CONFLICT (job) DO UPDATE SET
      last_venue_id = EXCLUDED.last_venue_id,
      cycles        = cron_cursors.cycles + ${slice.wrapped ? 1 : 0},
      updated_at    = now()`;
}
