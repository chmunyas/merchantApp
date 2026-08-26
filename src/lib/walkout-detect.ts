// C9.1 -> B2.8: turn detected potential walkouts into staff alerts.
//
// Kept out of `src/lib/walkouts.ts` on purpose — that module is the pure
// predicate plus its SQL, and the unit tests exercise it without dragging in the
// push/database runtime. This file is the thin side-effecting edge.
//
// The alert is advisory, not a report. It tells the server to go and look at the
// table; nothing is written to the walkout register until a human reports it.

import { getSql } from "@/lib/db";
import { deliverStaffNotification } from "@/lib/staff-notify";
import { loadWalkoutCandidates, loadWalkoutSettings } from "@/lib/walkouts";

/**
 * Page the servers following any table whose check has gone quiet with money
 * still on it.
 *
 * `dedupeKey` is per check, so a server is paged once about a given bill no
 * matter how often detection runs — the unique index on
 * `staff_notifications (venue_id, staff_id, dedupe_key)` does the rest.
 */
export async function runWalkoutDetection(
  env: unknown,
  venue: string,
  now: Date = new Date(),
): Promise<{ scanned: number; alerted: number }> {
  const sql = getSql(env);
  if (!sql || !venue) return { scanned: 0, alerted: 0 };

  const settings = await loadWalkoutSettings(sql, venue);
  if (!settings.enabled) return { scanned: 0, alerted: 0 };

  const rows = await loadWalkoutCandidates(sql, venue, settings, now);
  let alerted = 0;
  for (const row of rows) {
    if (!row.verdict.candidate) continue;
    const recipients = await deliverStaffNotification(env, {
      venue,
      type: "walkout.potential",
      table: row.tableKey ?? row.tableLabel,
      tableLabel: row.tableLabel,
      currency: row.currency,
      amountMinor: row.verdict.outstandingMinor,
      remainingMinor: row.verdict.outstandingMinor,
      idleMinutes: row.verdict.idleMinutes,
      dedupeKey: `walkout.potential:${row.orderId}`,
      url: "/dashboard/walkouts",
      data: { order_id: row.orderId, idle_minutes: row.verdict.idleMinutes },
    });
    if (recipients.length > 0) alerted += 1;
  }
  return { scanned: rows.length, alerted };
}
