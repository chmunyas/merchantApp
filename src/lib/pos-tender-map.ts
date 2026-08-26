// C5.6 / C5.7 / C5.11 — the tender map and the push ledger.
//
// `parseTenderMap` is pure and exported so the rule that matters most — a venue
// may declare exactly one `sunday` tender and at most one exception tender — is
// testable without a database. Ambiguity here is Sunday's discrepancy class 2
// (a payment attributed to the wrong payment method) waiting to happen.

import type { getSql } from "@/lib/db";
import type { PushStatus } from "@/lib/pos/tender";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type TenderRole = "sunday" | "exception" | "other";

export type TenderMapEntry = {
  posPaymentMethodId: string;
  label: string;
  role: TenderRole;
};

const ROLES: readonly TenderRole[] = ["sunday", "exception", "other"];

export function parseTenderMap(
  value: unknown,
): { tenders: TenderMapEntry[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "tenders must be an array" };
  const tenders: TenderMapEntry[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 50)) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const posPaymentMethodId = String(raw.posPaymentMethodId ?? "").trim().slice(0, 200);
    const label = String(raw.label ?? "").trim().slice(0, 120);
    const role = ROLES.includes(raw.role as TenderRole)
      ? (raw.role as TenderRole)
      : "other";
    if (!posPaymentMethodId) continue;
    if (seen.has(posPaymentMethodId)) {
      return { error: `duplicate POS payment method ${posPaymentMethodId}` };
    }
    seen.add(posPaymentMethodId);
    tenders.push({ posPaymentMethodId, label: label || posPaymentMethodId, role });
  }
  const sunday = tenders.filter((t) => t.role === "sunday").length;
  if (sunday > 1) {
    return { error: "only one POS payment method can be the sunday tender" };
  }
  if (tenders.filter((t) => t.role === "exception").length > 1) {
    return { error: "only one POS payment method can be the exception tender" };
  }
  return { tenders };
}

export async function listTenderMap(
  sql: Sql,
  venue: string,
): Promise<TenderMapEntry[]> {
  const rows = await sql`
    SELECT pos_payment_method_id, label, role
    FROM pos_tender_map
    WHERE venue_id = ${venue}
    ORDER BY role, label`;
  return rows.map((row) => ({
    posPaymentMethodId: String(row.pos_payment_method_id),
    label: String(row.label),
    role: row.role as TenderRole,
  }));
}

export async function replaceTenderMap(
  sql: Sql,
  venue: string,
  connectionId: string,
  tenders: readonly TenderMapEntry[],
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM pos_tender_map WHERE venue_id = ${venue}`;
    for (const tender of tenders) {
      await tx`
        INSERT INTO pos_tender_map
          (venue_id, connection_id, pos_payment_method_id, label, role)
        VALUES (${venue}, ${connectionId}, ${tender.posPaymentMethodId},
                ${tender.label}, ${tender.role})`;
    }
  });
}

export type PushRow = {
  id: string;
  paymentId: string;
  posBillId: string | null;
  posPaymentId: string | null;
  tableLabel: string | null;
  amountMinor: number;
  tipMinor: number;
  status: PushStatus;
  attempts: number;
  lastError: string | null;
  lastErrorCode: string | null;
  notifiedAt: string | null;
  recordedBy: string | null;
  createdAt: string;
};

export async function listPushes(
  sql: Sql,
  venue: string,
  status: PushStatus | null,
): Promise<PushRow[]> {
  const rows = status
    ? await sql`
        SELECT p.id, p.payment_id, p.pos_bill_id, p.pos_payment_id, t.label AS table_label,
               p.amount_minor, p.tip_minor, p.status, p.attempts, p.last_error,
               p.last_error_code, p.notified_at, p.recorded_by, p.created_at
        FROM pos_tender_pushes p
        LEFT JOIN pos_checks c ON c.id = p.check_id AND c.venue_id = p.venue_id
        LEFT JOIN dining_tables t ON t.id = c.table_id AND t.venue_id = p.venue_id
        WHERE p.venue_id = ${venue} AND p.status = ${status}
        ORDER BY p.created_at DESC
        LIMIT 200`
    : await sql`
        SELECT p.id, p.payment_id, p.pos_bill_id, p.pos_payment_id, t.label AS table_label,
               p.amount_minor, p.tip_minor, p.status, p.attempts, p.last_error,
               p.last_error_code, p.notified_at, p.recorded_by, p.created_at
        FROM pos_tender_pushes p
        LEFT JOIN pos_checks c ON c.id = p.check_id AND c.venue_id = p.venue_id
        LEFT JOIN dining_tables t ON t.id = c.table_id AND t.venue_id = p.venue_id
        WHERE p.venue_id = ${venue}
        ORDER BY p.created_at DESC
        LIMIT 200`;
  return rows.map((row) => ({
    id: String(row.id),
    paymentId: String(row.payment_id),
    posBillId: (row.pos_bill_id as string | null) ?? null,
    posPaymentId: (row.pos_payment_id as string | null) ?? null,
    tableLabel: (row.table_label as string | null) ?? null,
    amountMinor: Number(row.amount_minor) || 0,
    tipMinor: Number(row.tip_minor) || 0,
    status: row.status as PushStatus,
    attempts: Number(row.attempts) || 0,
    lastError: (row.last_error as string | null) ?? null,
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    notifiedAt: row.notified_at ? new Date(row.notified_at as string).toISOString() : null,
    recordedBy: (row.recorded_by as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
}

/**
 * A manager keyed the payment onto the POS by hand. Only an unsynced payment can
 * be recorded: marking a `notified` push as manual would invent a second tender
 * line that does not exist on the check.
 */
export async function markPushRecorded(
  sql: Sql,
  venue: string,
  pushId: string,
  actor: string,
  posPaymentId: string | null,
): Promise<boolean> {
  const rows = await sql`
    UPDATE pos_tender_pushes
    SET status = 'manual', recorded_by = ${actor}, recorded_at = now(),
        pos_payment_id = COALESCE(${posPaymentId}, pos_payment_id),
        updated_at = now()
    WHERE id = ${pushId} AND venue_id = ${venue} AND status = 'not_notified'
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Put an unsynced payment back in the queue. Attempts are reset so a manager who
 * has just fixed the POS gets the full retry budget again, and `alerted_at` is
 * cleared so a second failure pages the floor again rather than failing silently.
 */
export async function requeuePush(
  sql: Sql,
  venue: string,
  pushId: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE pos_tender_pushes
    SET status = 'pending', attempts = 0, next_attempt_at = now(),
        alerted_at = NULL, last_error = NULL, last_error_code = NULL,
        lease_expires_at = NULL, claim_token = NULL, updated_at = now()
    WHERE id = ${pushId} AND venue_id = ${venue} AND status = 'not_notified'
    RETURNING id`;
  return rows.length > 0;
}
