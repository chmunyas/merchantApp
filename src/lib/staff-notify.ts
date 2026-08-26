// Delivery side of the Sunday-parity staff notifications (roadmap B2).
//
// Reuses the existing Web Push plumbing end to end: the same `push_subscriptions`
// rows, the same VAPID keypair, the same payloadless tickle, and the same
// service worker fetch of /api/push/latest. The only thing added here is WHO
// gets woken — resolved by the pure filter in `staff-notifications.ts`.
//
// Every call is best-effort: a notification failure must never fail a payment,
// an order, or a review.

import { getSql, type Sql } from "@/lib/db";
import { tickleStaffDevices } from "@/lib/push";
import {
  formatStaffNotification,
  selectRecipients,
  type FollowedTable,
  type NotificationCandidate,
  type StaffNotificationContext,
  type StaffNotificationType,
} from "@/lib/staff-notifications";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TableRef = { key: string | null; label: string | null };

/**
 * Normalise whatever the event knows about the table into a stable pair.
 *
 * Orders carry `table_id` (a floorplan uuid OR a free-text label) while payment
 * metadata usually carries `table_number` ("12"). Resolving both to
 * `{ dining_tables.id, label }` is what lets a payment on "12" match a server
 * who followed the floorplan row for table 12.
 */
export async function resolveTableRef(
  sql: Sql,
  venue: string,
  hint: unknown,
): Promise<TableRef | null> {
  const raw = hint == null ? "" : String(hint).trim();
  if (!raw) return null;
  try {
    if (UUID.test(raw)) {
      const [row] = await sql`
        SELECT id, label FROM dining_tables
        WHERE id = ${raw} AND venue_id = ${venue} LIMIT 1`;
      if (row) return { key: String(row.id), label: String(row.label) };
      return { key: raw, label: null };
    }
    const [row] = await sql`
      SELECT id, label FROM dining_tables
      WHERE venue_id = ${venue} AND lower(label) = lower(${raw})
      ORDER BY created_at LIMIT 1`;
    if (row) return { key: String(row.id), label: String(row.label) };
  } catch {
    /* fall through to the raw hint */
  }
  return { key: raw, label: raw };
}

type CandidateRow = {
  staff_id: string;
  prefs: Record<string, boolean> | null;
  follows: Array<{ key: string | null; label: string | null }> | null;
  on_shift: boolean | null;
};

/**
 * Every active staff member in THIS venue, with their opt-in overrides (B2.14),
 * the tables they follow (B2.13) and a cheap shift signal (B2.15).
 *
 * `on_shift` is NULL when the venue has never opened a shift for that person —
 * shift tracking is optional, so absence must not silence their alerts. It is
 * false only when they have shift history and none of it is currently open.
 */
export async function loadNotificationCandidates(
  sql: Sql,
  venue: string,
): Promise<NotificationCandidate[]> {
  const rows = (await sql`
    SELECT s.id::text AS staff_id,
           pref.prefs,
           fol.follows,
           sh.on_shift
    FROM staff s
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(p.type, p.enabled) AS prefs
      FROM staff_notification_prefs p
      WHERE p.venue_id = s.venue_id AND p.staff_id = s.id
    ) pref ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('key', t.table_key, 'label', t.table_label)) AS follows
      FROM staff_table_subscriptions t
      WHERE t.venue_id = s.venue_id AND t.staff_id = s.id
    ) fol ON true
    LEFT JOIN LATERAL (
      SELECT bool_or(x.status = 'open') AS on_shift
      FROM shifts x
      WHERE x.venue_id = s.venue_id AND x.staff_id = s.id
    ) sh ON true
    WHERE s.venue_id = ${venue} AND s.active = true`) as unknown as CandidateRow[];

  return rows.map((row) => ({
    staffId: String(row.staff_id),
    venue,
    prefs: (row.prefs ?? {}) as Record<string, boolean>,
    follows: (row.follows ?? []).filter(
      (f): f is FollowedTable => Boolean(f && (f.key || f.label)),
    ),
    onShift: row.on_shift === null ? null : Boolean(row.on_shift),
  }));
}

export type StaffNotifyInput = StaffNotificationContext & {
  venue: string;
  type: StaffNotificationType;
  /** Raw table reference (floorplan uuid, or a label such as "12"). */
  table?: unknown;
  /** Direct attribution — beats table follows (e.g. the server a tip belongs to). */
  targetStaffId?: string | null;
  /** Makes a redelivered webhook / replayed PATCH idempotent per recipient. */
  dedupeKey?: string | null;
  url?: string | null;
  data?: Record<string, unknown>;
};

/**
 * Fan an event out to the staff who asked for it, on the tables they follow.
 * Returns the staff ids that were notified (empty is a normal outcome — nobody
 * is following that table).
 */
export async function deliverStaffNotification(
  env: unknown,
  input: StaffNotifyInput,
): Promise<string[]> {
  try {
    const sql = getSql(env);
    if (!sql || !input.venue) return [];

    const tableRef = await resolveTableRef(sql, input.venue, input.table);
    const tableLabel = input.tableLabel ?? tableRef?.label ?? null;
    const candidates = await loadNotificationCandidates(sql, input.venue);
    const recipients = selectRecipients(
      {
        venue: input.venue,
        type: input.type,
        tableKey: tableRef?.key ?? null,
        tableLabel,
        targetStaffId: input.targetStaffId ?? null,
      },
      candidates,
    );
    if (recipients.length === 0) return [];

    const { title, body } = formatStaffNotification(input.type, {
      ...input,
      tableLabel,
    });
    const payload = JSON.parse(
      JSON.stringify({
        ...(input.data ?? {}),
        type: input.type,
        table: tableLabel,
      }),
    );

    for (const staffId of recipients) {
      await sql`
        INSERT INTO staff_notifications
          (venue_id, staff_id, type, title, body, table_key, table_label,
           amount_minor, remaining_minor, currency, url, dedupe_key, data)
        VALUES
          (${input.venue}, ${staffId}, ${input.type}, ${title}, ${body},
           ${tableRef?.key ?? null}, ${tableLabel},
           ${input.amountMinor ?? null}, ${input.remainingMinor ?? null},
           ${input.currency || "KES"}, ${input.url ?? null},
           ${input.dedupeKey ?? null}, ${sql.json(payload)})
        ON CONFLICT DO NOTHING`;
    }

    await tickleStaffDevices(env, input.venue, recipients);
    return recipients;
  } catch {
    // Best-effort by design — never let an alert break the flow that produced it.
    return [];
  }
}

/** Deliver a batch, preserving order. Used by the payment ledger path. */
export async function deliverStaffNotifications(
  env: unknown,
  inputs: readonly StaffNotifyInput[],
): Promise<void> {
  for (const input of inputs) {
    await deliverStaffNotification(env, input);
  }
}
