// C9 walkout protection — detection, register plumbing and recovery.
//
// Sunday's documented flow (help centre article 13718868 "How to Report a
// Walkout") is deliberately conservative about the check:
//
//   Step 1  LEAVE THE CHECK OPEN. Do not close or remove it — keeping the table
//           open is what lets the guest still complete payment from their phone.
//   Step 2  Report it from the dashboard OR the staff app.
//   Step 3  Submit the table number and the amount remaining on the bill.
//   Then    If the guest pays, the check closes automatically. If not, the
//           walkout is reviewed against criteria.
//
// Nothing in this module closes, cancels or voids an order. Reporting a walkout
// is purely additive: it writes a register row and an audit event. The ONLY
// thing that closes the check is a real payment, through the existing
// `consumer === "order"` path in `financial-consumers.ts`.
//
// Deliberately absent: Sunday's coverage guarantee (C9.5). Whether a venue is
// reimbursed, and whether a server's tip is made good, is an underwriting
// decision. This module models a lifecycle that CAN carry that outcome later
// (`status = 'under_review'` + `review_outcome`) and computes no covered amount.

import type { QuerySql } from "@/lib/db";

// --- Settings -----------------------------------------------------------

export type WalkoutSettings = {
  enabled: boolean;
  /**
   * Minutes of no activity on an open check before it is a candidate. Venue
   * local on purpose: 45 minutes is abandonment at a counter and normal service
   * on a tasting menu, so a hardcoded threshold is wrong for somebody.
   */
  idleMinutes: number;
  /** Sunday's precondition — the QR must have been scanned during table service. */
  requireQrScan: boolean;
};

export const DEFAULT_WALKOUT_SETTINGS: WalkoutSettings = {
  enabled: true,
  idleMinutes: 45,
  requireQrScan: true,
};

export const MIN_IDLE_MINUTES = 5;
export const MAX_IDLE_MINUTES = 1440;

export function normalizeWalkoutSettings(value: unknown): WalkoutSettings {
  const input = (value ?? {}) as Record<string, unknown>;
  const idle = Number(input.idleMinutes);
  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : DEFAULT_WALKOUT_SETTINGS.enabled,
    idleMinutes: Number.isFinite(idle)
      ? Math.min(MAX_IDLE_MINUTES, Math.max(MIN_IDLE_MINUTES, Math.round(idle)))
      : DEFAULT_WALKOUT_SETTINGS.idleMinutes,
    requireQrScan:
      typeof input.requireQrScan === "boolean"
        ? input.requireQrScan
        : DEFAULT_WALKOUT_SETTINGS.requireQrScan,
  };
}

// --- The detection predicate -------------------------------------------

export const WALKOUT_STATUSES = [
  "open",
  "under_review",
  "recovered",
  "written_off",
  "dismissed",
] as const;

export type WalkoutStatus = (typeof WALKOUT_STATUSES)[number];

export function isWalkoutStatus(value: unknown): value is WalkoutStatus {
  return (
    typeof value === "string" &&
    (WALKOUT_STATUSES as readonly string[]).includes(value)
  );
}

/** A closed check is never a walkout, whatever else is true of it. */
const CLOSED_ORDER_STATUSES = new Set(["cancelled", "refunded", "void"]);

export type WalkoutSignals = {
  orderId: string;
  tableKey: string | null;
  tableLabel: string | null;
  /** Bill total, minor units. */
  totalMinor: number;
  /** Settled principal (tips excluded), minor units. */
  paidMinor: number;
  currency?: string | null;
  /** Order lifecycle status. */
  orderStatus: string;
  /** Non-null once the check settled in full. */
  paidAt: string | Date | null;
  /** When the guest last scanned the table QR against this check. */
  qrScannedAt: string | Date | null;
  /** Most recent order/payment/scan activity on the check. */
  lastActivityAt: string | Date;
  /** A live walkout is already on the register for this check. */
  alreadyReported: boolean;
};

export type WalkoutReason =
  | "candidate"
  | "detection_disabled"
  | "check_closed"
  | "settled"
  | "no_balance"
  | "already_reported"
  | "no_qr_scan"
  | "not_idle";

export type WalkoutVerdict = {
  candidate: boolean;
  reason: WalkoutReason;
  outstandingMinor: number;
  idleMinutes: number;
};

function toTime(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

function minutesSince(value: string | Date | null | undefined, now: Date): number {
  const time = toTime(value);
  if (time == null) return 0;
  return Math.max(0, Math.floor((now.getTime() - time) / 60_000));
}

/**
 * Is this open check a potential walkout?
 *
 * The three signals Sunday's flow relies on, and nothing else: the QR was
 * scanned during table service, the check still carries a balance, and the table
 * has gone quiet for longer than the venue tolerates.
 *
 * Check order is meaningful — the cheapest disqualifiers run first, and
 * `already_reported` outranks the idle test so a re-run of detection never pages
 * the floor twice about a walkout somebody has already dealt with.
 */
export function evaluateWalkout(
  signals: WalkoutSignals,
  settings: WalkoutSettings = DEFAULT_WALKOUT_SETTINGS,
  now: Date = new Date(),
): WalkoutVerdict {
  const outstandingMinor = Math.max(
    0,
    Math.round(Number(signals.totalMinor) || 0) -
      Math.round(Number(signals.paidMinor) || 0),
  );
  const idleMinutes = minutesSince(signals.lastActivityAt, now);
  const verdict = (reason: WalkoutReason): WalkoutVerdict => ({
    candidate: reason === "candidate",
    reason,
    outstandingMinor,
    idleMinutes,
  });

  if (!settings.enabled) return verdict("detection_disabled");
  if (CLOSED_ORDER_STATUSES.has(String(signals.orderStatus).toLowerCase())) {
    return verdict("check_closed");
  }
  if (toTime(signals.paidAt) != null) return verdict("settled");
  if (outstandingMinor <= 0) return verdict("no_balance");
  if (signals.alreadyReported) return verdict("already_reported");
  if (settings.requireQrScan && toTime(signals.qrScannedAt) == null) {
    return verdict("no_qr_scan");
  }
  if (idleMinutes < settings.idleMinutes) return verdict("not_idle");
  return verdict("candidate");
}

export function isWalkoutCandidate(
  signals: WalkoutSignals,
  settings: WalkoutSettings = DEFAULT_WALKOUT_SETTINGS,
  now: Date = new Date(),
): boolean {
  return evaluateWalkout(signals, settings, now).candidate;
}

// --- Persistence --------------------------------------------------------

export async function loadWalkoutSettings(
  sql: QuerySql,
  venue: string,
): Promise<WalkoutSettings> {
  const [row] = await sql`
    SELECT enabled, idle_minutes, require_qr_scan
    FROM venue_walkout_settings
    WHERE venue_id = ${venue}
    LIMIT 1`;
  if (!row) return DEFAULT_WALKOUT_SETTINGS;
  return normalizeWalkoutSettings({
    enabled: row.enabled,
    idleMinutes: Number(row.idle_minutes),
    requireQrScan: row.require_qr_scan,
  });
}

export async function saveWalkoutSettings(
  sql: QuerySql,
  venue: string,
  settings: WalkoutSettings,
): Promise<WalkoutSettings> {
  await sql`
    INSERT INTO venue_walkout_settings
      (venue_id, enabled, idle_minutes, require_qr_scan, updated_at)
    VALUES (${venue}, ${settings.enabled}, ${settings.idleMinutes},
            ${settings.requireQrScan}, now())
    ON CONFLICT (venue_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      idle_minutes = EXCLUDED.idle_minutes,
      require_qr_scan = EXCLUDED.require_qr_scan,
      updated_at = now()`;
  return settings;
}

export type WalkoutCandidate = WalkoutSignals & {
  verdict: WalkoutVerdict;
  currency: string;
  createdAt: string;
};

type CandidateRow = {
  order_id: string;
  table_key: string | null;
  table_label: string | null;
  order_status: string;
  total: string | number;
  paid: string | number;
  currency: string;
  paid_at: string | null;
  qr_scanned_at: string | null;
  last_activity_at: string;
  created_at: string;
  already_reported: boolean;
};

/**
 * Every open check in the venue, each with its verdict.
 *
 * Returns non-candidates too: the guided report flow (C9.2) needs to show a
 * server the table they are standing at even when detection has not flagged it,
 * and telling them WHY it is not flagged ("not idle yet") is more useful than an
 * empty list. Callers that only want alerts filter on `verdict.candidate`.
 */
export async function loadWalkoutCandidates(
  sql: QuerySql,
  venue: string,
  settings: WalkoutSettings,
  now: Date = new Date(),
): Promise<WalkoutCandidate[]> {
  const rows = (await sql`
    SELECT o.id::text                       AS order_id,
           dt.id::text                      AS table_key,
           COALESCE(dt.label, o.table_id)   AS table_label,
           o.status                         AS order_status,
           o.total::bigint                  AS total,
           COALESCE(pay.paid, 0)::bigint    AS paid,
           o.currency,
           o.paid_at,
           scan.last_scan_at                AS qr_scanned_at,
           GREATEST(
             o.updated_at,
             o.created_at,
             COALESCE(pay.last_payment_at, o.created_at),
             COALESCE(scan.last_scan_at, o.created_at)
           )                                AS last_activity_at,
           o.created_at,
           (w.id IS NOT NULL)               AS already_reported
    FROM orders o
    LEFT JOIN dining_tables dt
      ON dt.venue_id = o.venue_id
     AND o.table_id IS NOT NULL
     AND (
       (o.table_id ~ '^[0-9a-fA-F-]{36}$' AND dt.id::text = o.table_id)
       OR lower(dt.label) = lower(o.table_id)
     )
    LEFT JOIN LATERAL (
      SELECT order_paid_minor(o.venue_id, o.id) AS paid,
             max(p.created_at) AS last_payment_at
      FROM payments p
      WHERE p.venue_id = o.venue_id
        AND (
          p.metadata->>'order_id' = o.id::text
          OR p.metadata->>'refund_of' IN (
            SELECT original.id FROM payments original
            WHERE original.venue_id = o.venue_id
              AND original.metadata->>'order_id' = o.id::text
          )
        )
    ) pay ON true
    LEFT JOIN LATERAL (
      SELECT max(s.scanned_at) AS last_scan_at
      FROM qr_scans s
      JOIN qr_codes c ON c.id = s.code_id AND c.venue_id = o.venue_id
      WHERE s.venue_id = o.venue_id
        AND dt.id IS NOT NULL
        AND c.table_id = dt.id
        AND s.scanned_at >= o.created_at - interval '2 hours'
    ) scan ON true
    LEFT JOIN walkouts w
      ON w.venue_id = o.venue_id
     AND w.order_id = o.id
     AND w.status IN ('open','under_review')
    WHERE o.venue_id = ${venue}
      AND o.paid_at IS NULL
      AND o.status NOT IN ('cancelled')
      AND o.total > 0
      AND o.created_at > now() - interval '2 days'
    ORDER BY o.created_at
    LIMIT 200`) as unknown as CandidateRow[];

  return rows.map((row) => {
    const signals: WalkoutSignals = {
      orderId: String(row.order_id),
      tableKey: row.table_key ? String(row.table_key) : null,
      tableLabel: row.table_label ? String(row.table_label) : null,
      totalMinor: Number(row.total) || 0,
      paidMinor: Number(row.paid) || 0,
      currency: row.currency || "KES",
      orderStatus: String(row.order_status || ""),
      paidAt: row.paid_at,
      qrScannedAt: row.qr_scanned_at,
      lastActivityAt: row.last_activity_at,
      alreadyReported: Boolean(row.already_reported),
    };
    return {
      ...signals,
      currency: row.currency || "KES",
      createdAt: String(row.created_at),
      verdict: evaluateWalkout(signals, settings, now),
    };
  });
}

// --- Audit trail --------------------------------------------------------

export type WalkoutActor = {
  id: string | null;
  name: string | null;
  role: string | null;
};

export async function recordWalkoutEvent(
  sql: QuerySql,
  input: {
    venue: string;
    walkoutId: string;
    event: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    actor?: WalkoutActor | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    INSERT INTO walkout_events
      (venue_id, walkout_id, event, from_status, to_status,
       actor_id, actor_name, actor_role, detail)
    VALUES (${input.venue}, ${input.walkoutId}, ${input.event},
            ${input.fromStatus ?? null}, ${input.toStatus ?? null},
            ${input.actor?.id ?? null}, ${input.actor?.name ?? null},
            ${input.actor?.role ?? null},
            ${sql.json(JSON.parse(JSON.stringify(input.detail ?? {})))})`;
}

// --- C9.4 recovery ------------------------------------------------------

/**
 * The guest came back to the bill from their phone and paid.
 *
 * Called from the SAME financial consumer that stamps `orders.paid_at`, so
 * recovery is a consequence of the existing payment path rather than a second,
 * forkable one: if the check closes, any live walkout on it closes with it.
 *
 * Returns the walkout ids that moved to `recovered` (usually zero or one).
 */
export async function recoverWalkoutsForPaidOrder(
  sql: QuerySql,
  input: {
    venue: string;
    orderId: string;
    paymentId?: string | null;
    paidMinor?: number | null;
  },
): Promise<string[]> {
  const rows = (await sql`
    UPDATE walkouts
    SET status = 'recovered',
        recovered_minor = GREATEST(recovered_minor, ${Math.max(
          0,
          Math.round(Number(input.paidMinor ?? 0)) || 0,
        )}),
        recovered_payment_id = COALESCE(recovered_payment_id, ${input.paymentId ?? null}),
        resolved_at = COALESCE(resolved_at, now()),
        updated_at = now()
    WHERE venue_id = ${input.venue}
      AND order_id = ${input.orderId}
      AND status IN ('open', 'under_review')
    RETURNING id::text AS id`) as unknown as Array<{ id: string }>;

  for (const row of rows) {
    await recordWalkoutEvent(sql, {
      venue: input.venue,
      walkoutId: String(row.id),
      event: "recovered",
      toStatus: "recovered",
      actor: { id: input.paymentId ?? null, name: "Guest payment", role: "system" },
      detail: {
        order_id: input.orderId,
        payment_id: input.paymentId ?? null,
        recovered_minor: Math.max(0, Math.round(Number(input.paidMinor ?? 0)) || 0),
      },
    });
  }
  return rows.map((row) => String(row.id));
}
