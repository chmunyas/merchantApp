// The Sunday tip-distribution engine (roadmap D5.5, D5.6, D5.7, D5.8, B4.2).
//
// Three models, one weekly pool:
//   * `direct` — 100% to the attributed server, paid automatically the Monday
//     after the collection week closes.
//   * `jar`    — 100% into the jar; the manager distributes it once the jar
//     opens (Monday 18:00 venue-local) and staff are paid the Monday after the
//     distribution week.
//   * `split`  — each server's own `direct_pct` goes direct, the remainder to
//     the jar. Tips with no attributed server always go to the jar.
//
// One `tip_pools` row per venue per collection week (`kind='weekly'`) carries
// both streams; `tip_pool_sources` records the direct/jar split for every single
// payment id, so any number rendered anywhere traces back to a payment.

import type { QuerySql, Sql } from "@/lib/db";
import {
  allocateFixedTips,
  allocateWeightedTips,
  splitDirectJar,
} from "@/lib/tip-allocation";
import {
  addDaysToIsoDate,
  jarIsOpen,
  localWeekStart,
  openJarWeek,
  payoutMondayFor,
  tipWeek,
  weeksLateFor,
  type TipWeek,
} from "@/lib/tip-cadence";

export type TipModel = "direct" | "jar" | "split";
export type JarMethod = "by_hours" | "fixed";

export type VenueTipSettings = {
  model: TipModel;
  defaultDirectPct: number;
  jarMethod: JarMethod;
  timeZone: string;
};

export const DEFAULT_TIP_SETTINGS: VenueTipSettings = {
  model: "direct",
  defaultDirectPct: 100,
  jarMethod: "by_hours",
  timeZone: "Africa/Nairobi",
};

/** How many closed weeks a cadence run will reach back and settle. */
const WEEK_LOOKBACK = 8;

export function isTipModel(value: unknown): value is TipModel {
  return value === "direct" || value === "jar" || value === "split";
}

export function isJarMethod(value: unknown): value is JarMethod {
  return value === "by_hours" || value === "fixed";
}

export async function loadTipSettings(
  sql: QuerySql,
  venue: string,
): Promise<VenueTipSettings> {
  const [row] = await sql`
    SELECT s.model, s.default_direct_pct, s.jar_method, v.timezone
    FROM venues v
    LEFT JOIN venue_tip_settings s ON s.venue_id = v.id
    WHERE v.id = ${venue}
    LIMIT 1`;
  if (!row) return DEFAULT_TIP_SETTINGS;
  return {
    model: isTipModel(row.model) ? row.model : DEFAULT_TIP_SETTINGS.model,
    defaultDirectPct:
      row.default_direct_pct == null
        ? DEFAULT_TIP_SETTINGS.defaultDirectPct
        : Number(row.default_direct_pct),
    jarMethod: isJarMethod(row.jar_method) ? row.jar_method : DEFAULT_TIP_SETTINGS.jarMethod,
    timeZone: String(row.timezone || DEFAULT_TIP_SETTINGS.timeZone),
  };
}

/** Per-server direct percentage overrides. Only meaningful for the split model. */
export async function loadDirectOverrides(
  sql: QuerySql,
  venue: string,
): Promise<Map<string, number>> {
  const rows = await sql`
    SELECT staff_id, direct_pct FROM staff_tip_rules WHERE venue_id = ${venue}`;
  return new Map(rows.map((row) => [String(row.staff_id), Number(row.direct_pct)]));
}

/**
 * The share of a server's tip that goes straight to them. `direct` and `jar` are
 * absolutes — a per-server override only applies under the split model, which is
 * the only model where Sunday exposes the percentage at all.
 */
export function effectiveDirectPct(
  settings: VenueTipSettings,
  override?: number | null,
): number {
  if (settings.model === "direct") return 100;
  if (settings.model === "jar") return 0;
  const value = override ?? settings.defaultDirectPct;
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

export type WeeklyPool = {
  id: string;
  week_start: string;
  period_start: string;
  period_end: string;
  net_tips: number;
  direct_tips: number;
  jar_tips: number;
  distributed_at: string | null;
  scheduled_payout_at: string | null;
  jar_method: string | null;
  weeks_late: number | null;
  model: string | null;
  idempotency_key: string | null;
};

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function poolShape(row: Record<string, unknown>): WeeklyPool {
  return {
    id: String(row.id),
    week_start: String(row.week_start_iso ?? ""),
    period_start: iso(row.period_start) ?? "",
    period_end: iso(row.period_end) ?? "",
    net_tips: Number(row.net_tips ?? 0),
    direct_tips: Number(row.direct_tips ?? 0),
    jar_tips: Number(row.jar_tips ?? 0),
    distributed_at: iso(row.distributed_at),
    scheduled_payout_at: iso(row.scheduled_payout_at),
    jar_method: row.jar_method == null ? null : String(row.jar_method),
    weeks_late: row.weeks_late == null ? null : Number(row.weeks_late),
    model: row.model == null ? null : String(row.model),
    idempotency_key: row.idempotency_key == null ? null : String(row.idempotency_key),
  };
}

/**
 * Close a collection week: snapshot every tipping payment into the pool with its
 * direct/jar split and create the direct-stream allocations. Idempotent — a week
 * already closed is returned untouched.
 */
export async function ensureWeeklyPool(
  tx: QuerySql,
  venue: string,
  week: TipWeek,
  settings: VenueTipSettings,
): Promise<WeeklyPool> {
  const [existing] = await tx`
    SELECT *, to_char(week_start, 'YYYY-MM-DD') AS week_start_iso FROM tip_pools
    WHERE venue_id = ${venue} AND kind = 'weekly' AND week_start = ${week.weekStart}
    LIMIT 1`;
  if (existing) return poolShape(existing);

  const overrides = await loadDirectOverrides(tx, venue);
  const sources = await tx`
    SELECT fps.payment_id, p.staff_id, fps.tip_amount AS gross_tip,
           GREATEST(0, fps.tip_amount - COALESCE((
             SELECT sum(fa.amount) FROM financial_adjustments fa
             WHERE fa.payment_id = fps.payment_id AND fa.component = 'tip'
           ), 0))::bigint AS net_tip,
           COALESCE(p.metadata->>'channel', p.metadata->>'source', p.provider, 'qr') AS channel
    FROM financial_payment_snapshots fps
    JOIN payments p ON p.id = fps.payment_id AND p.venue_id = fps.venue_id
    WHERE fps.venue_id = ${venue} AND fps.currency = 'KES'
      AND fps.created_at >= ${week.collectionStart} AND fps.created_at < ${week.collectionEnd}
      AND fps.tip_amount > 0
      AND NOT EXISTS (SELECT 1 FROM tip_pool_sources tps
                      WHERE tps.venue_id = ${venue} AND tps.payment_id = fps.payment_id)
    ORDER BY fps.payment_id`;

  let gross = 0;
  let net = 0;
  let directTotal = 0;
  let jarTotal = 0;
  const perStaffDirect = new Map<string, number>();
  const rows = sources.map((source) => {
    const staffId = source.staff_id ? String(source.staff_id) : null;
    const netTip = Number(source.net_tip);
    // An unattributed tip has no server to pay directly, so it is always jar.
    const pct = staffId ? effectiveDirectPct(settings, overrides.get(staffId)) : 0;
    const split = splitDirectJar(netTip, pct);
    gross += Number(source.gross_tip);
    net += netTip;
    directTotal += split.direct;
    jarTotal += split.jar;
    if (staffId && split.direct > 0) {
      perStaffDirect.set(staffId, (perStaffDirect.get(staffId) ?? 0) + split.direct);
    }
    return {
      paymentId: String(source.payment_id),
      staffId,
      grossTip: Number(source.gross_tip),
      netTip,
      channel: String(source.channel ?? "qr"),
      ...split,
    };
  });

  const period = `${week.collectionStart.toISOString()}/${week.collectionEnd.toISOString()}`;
  const [created] = await tx`
    INSERT INTO tip_pools
      (venue_id, kind, model, rule, period, period_start, period_end, currency,
       gross_tips, refunded_tips, net_tips, direct_tips, jar_tips,
       week_start, opens_at, created_by)
    VALUES (${venue}, 'weekly', ${settings.model}, 'direct', ${period},
            ${week.collectionStart}, ${week.collectionEnd}, 'KES',
            ${gross}, ${gross - net}, ${net}, ${directTotal}, ${jarTotal},
            ${week.weekStart}, ${week.opensAt}, 'cadence')
    RETURNING *, to_char(week_start, 'YYYY-MM-DD') AS week_start_iso`;

  for (const row of rows) {
    await tx`
      INSERT INTO tip_pool_sources
        (pool_id, venue_id, payment_id, gross_tip, refunded_tip, net_tip, staff_id,
         direct_tip, jar_tip, channel)
      VALUES (${created.id}, ${venue}, ${row.paymentId}, ${row.grossTip},
              ${row.grossTip - row.netTip}, ${row.netTip}, ${row.staffId},
              ${row.direct}, ${row.jar}, ${row.channel})
      ON CONFLICT (venue_id, payment_id) DO NOTHING`;
  }

  for (const [staffId, amount] of [...perStaffDirect].sort(([a], [b]) => a.localeCompare(b))) {
    await tx`
      INSERT INTO tip_allocations
        (pool_id, venue_id, staff_id, amount, period, currency, entry_type, stream)
      VALUES (${created.id}, ${venue}, ${staffId}, ${amount}, ${period}, 'KES',
              'allocation', 'direct')
      ON CONFLICT DO NOTHING`;
  }

  return poolShape(created);
}

/**
 * Close every collection week that has ended and is not yet pooled. Returns the
 * week starts that were closed by this run.
 */
export async function closeDueWeeks(
  sql: Sql,
  venue: string,
  now: Date,
  settings: VenueTipSettings,
): Promise<string[]> {
  const thisMonday = localWeekStart(now, settings.timeZone);
  const closed: string[] = [];
  for (let back = WEEK_LOOKBACK; back >= 1; back -= 1) {
    const week = tipWeek(addDaysToIsoDate(thisMonday, -7 * back), settings.timeZone);
    if (week.collectionEnd.getTime() > now.getTime()) continue;
    const [existing] = await sql`
      SELECT 1 FROM tip_pools
      WHERE venue_id = ${venue} AND kind = 'weekly' AND week_start = ${week.weekStart}
      LIMIT 1`;
    if (existing) continue;
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`tip-week:${venue}`}, 0))`;
      await ensureWeeklyPool(tx, venue, week, settings);
    });
    closed.push(week.weekStart);
  }
  return closed;
}

export type JarDistributionInput = {
  venue: string;
  weekStart?: string | null;
  method: JarMethod;
  entries?: Array<{ staffId: string; amount: number }>;
  staffIds?: string[];
  idempotencyKey: string;
  actor: string;
  now: Date;
};

export type JarDistributionResult = {
  replay: boolean;
  pool: WeeklyPool;
  allocations: Array<{ staffId: string; amount: number }>;
  scheduledPayoutAt: string;
  weeksLate: number;
};

export class TipDistributionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** D5.6 / D5.3 / D5.4 — the manager distributes the jar for one collection week. */
export async function distributeJar(
  sql: Sql,
  settings: VenueTipSettings,
  input: JarDistributionInput,
): Promise<JarDistributionResult> {
  const week = input.weekStart
    ? tipWeek(input.weekStart, settings.timeZone)
    : openJarWeek(input.now, settings.timeZone);
  if (!jarIsOpen(week, input.now)) {
    throw new TipDistributionError(
      `The tip jar for the week of ${week.weekStart} opens on ${week.opensAt.toISOString()} (Monday 18:00 venue time).`,
      409,
    );
  }

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`tip-week:${input.venue}`}, 0))`;
    const pool = await ensureWeeklyPool(tx, input.venue, week, settings);

    if (pool.distributed_at) {
      if (pool.idempotency_key && pool.idempotency_key === input.idempotencyKey) {
        const existing = await tx`
          SELECT staff_id, amount FROM tip_allocations
          WHERE pool_id = ${pool.id} AND stream = 'jar' AND entry_type = 'allocation'
          ORDER BY staff_id`;
        return {
          replay: true,
          pool,
          allocations: existing.map((row) => ({
            staffId: String(row.staff_id),
            amount: Number(row.amount),
          })),
          scheduledPayoutAt: pool.scheduled_payout_at ?? "",
          weeksLate: pool.weeks_late ?? 0,
        };
      }
      throw new TipDistributionError(
        `The jar for the week of ${week.weekStart} was already distributed.`,
        409,
      );
    }

    const jarTotal = pool.jar_tips;
    if (jarTotal <= 0) {
      throw new TipDistributionError("There is nothing in the tip jar for this week.", 409);
    }

    let allocations: Array<{ staffId: string; amount: number }>;
    if (input.method === "fixed") {
      allocations = allocateFixedTips(jarTotal, input.entries ?? []);
    } else {
      const requested = input.staffIds ?? [];
      const staff = requested.length
        ? await tx`
          SELECT id FROM staff WHERE venue_id = ${input.venue}
            AND id IN (SELECT unnest(${requested}::uuid[])) ORDER BY id`
        : await tx`
          SELECT id FROM staff WHERE venue_id = ${input.venue} AND active = true ORDER BY id`;
      if (!staff.length) throw new TipDistributionError("No staff to distribute to.", 409);
      if (requested.length && staff.length !== requested.length) {
        throw new TipDistributionError("One or more staff do not belong to this venue.", 400);
      }
      const hours = await tx`
        SELECT staff_id,
               GREATEST(0, sum(EXTRACT(EPOCH FROM
                 (LEAST(closed_at, ${week.collectionEnd}) - GREATEST(opened_at, ${week.collectionStart})))
                 - break_minutes * 60))::bigint AS seconds
        FROM shifts
        WHERE venue_id = ${input.venue} AND status = 'closed' AND staff_id IS NOT NULL
          AND opened_at < ${week.collectionEnd} AND closed_at > ${week.collectionStart}
        GROUP BY staff_id`;
      const weights = new Map(hours.map((row) => [String(row.staff_id), Number(row.seconds)]));
      allocations = allocateWeightedTips(
        jarTotal,
        staff.map((row) => ({ staffId: String(row.id), weight: weights.get(String(row.id)) ?? 0 })),
      );
    }

    const ids = allocations.map((allocation) => allocation.staffId);
    if (ids.length) {
      const valid = await tx`
        SELECT id FROM staff WHERE venue_id = ${input.venue}
          AND id IN (SELECT unnest(${ids}::uuid[]))`;
      if (valid.length !== ids.length) {
        throw new TipDistributionError(
          "One or more staff do not belong to this venue.",
          400,
        );
      }
    }

    const period = `${week.collectionStart.toISOString()}/${week.collectionEnd.toISOString()}`;
    for (const allocation of allocations) {
      if (allocation.amount <= 0) continue;
      await tx`
        INSERT INTO tip_allocations
          (pool_id, venue_id, staff_id, amount, period, currency, entry_type, stream)
        VALUES (${pool.id}, ${input.venue}, ${allocation.staffId}, ${allocation.amount},
                ${period}, 'KES', 'allocation', 'jar')
        ON CONFLICT DO NOTHING`;
    }

    const scheduledPayoutAt = payoutMondayFor(input.now, settings.timeZone);
    const weeksLate = weeksLateFor(week, input.now, settings.timeZone);
    const [updated] = await tx`
      UPDATE tip_pools
      SET distributed_at = ${input.now}, distributed_by = ${input.actor},
          jar_method = ${input.method}, scheduled_payout_at = ${scheduledPayoutAt},
          weeks_late = ${weeksLate}, idempotency_key = ${input.idempotencyKey}
      WHERE id = ${pool.id} AND distributed_at IS NULL
      RETURNING *, to_char(week_start, 'YYYY-MM-DD') AS week_start_iso`;
    if (!updated) {
      throw new TipDistributionError("The jar was distributed by someone else.", 409);
    }

    return {
      replay: false,
      pool: poolShape(updated),
      allocations: allocations.filter((allocation) => allocation.amount > 0),
      scheduledPayoutAt: scheduledPayoutAt.toISOString(),
      weeksLate,
    };
  });
}

export type DuePayout = {
  id: string;
  staffId: string;
  amount: number;
  status: string;
  heldReason: string | null;
};

/**
 * Turn allocations that have reached their payout Monday into payout rows.
 * Direct-stream money is due the Monday the collection week closes (D5.5); jar
 * money is due on the Monday the distribution scheduled (D5.8).
 *
 * A staff member with no usable destination gets a `held` payout, not nothing:
 * the money stays reserved against their allocations and is released by a later
 * run once they add their details (B4.2).
 */
export async function issueDueTipPayouts(
  sql: Sql,
  venue: string,
  now: Date,
  actor = "cadence",
  periodLabel = now.toISOString().slice(0, 10),
): Promise<{ created: DuePayout[]; released: number; runId: string | null }> {
  const released = await sql`
    UPDATE tip_payouts SET status = 'pending', held_reason = NULL
    WHERE venue_id = ${venue} AND status = 'held'
      AND EXISTS (
        SELECT 1 FROM staff_payout_details d
        WHERE d.venue_id = tip_payouts.venue_id AND d.staff_id = tip_payouts.staff_id
          AND d.method = 'mpesa')
    RETURNING id`;

  const created = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`tip-payout:${venue}`}, 0))`;
    const due = await tx`
      SELECT a.id, a.staff_id, a.amount, a.stream,
             CASE WHEN a.stream = 'jar' THEN tp.scheduled_payout_at ELSE tp.period_end END AS due_at,
             d.method AS destination_method
      FROM tip_allocations a
      JOIN tip_pools tp ON tp.id = a.pool_id AND tp.venue_id = a.venue_id
      LEFT JOIN staff_payout_details d
        ON d.venue_id = a.venue_id AND d.staff_id = a.staff_id
      WHERE a.venue_id = ${venue} AND a.entry_type = 'allocation'
        AND tp.kind = 'weekly' AND a.staff_id IS NOT NULL AND a.amount > 0
        AND NOT EXISTS (SELECT 1 FROM tip_payout_items i WHERE i.allocation_id = a.id)
        AND (
          (a.stream = 'direct' AND tp.period_end <= ${now})
          OR (a.stream = 'jar' AND tp.scheduled_payout_at IS NOT NULL
              AND tp.scheduled_payout_at <= ${now})
        )
      ORDER BY a.staff_id, a.id
      FOR UPDATE OF a`;

    const grouped = new Map<
      string,
      { ids: string[]; amount: number; dueAt: Date; method: string | null }
    >();
    for (const row of due) {
      const staffId = String(row.staff_id);
      const entry = grouped.get(staffId) ?? {
        ids: [],
        amount: 0,
        dueAt: new Date(String(row.due_at)),
        method: row.destination_method ? String(row.destination_method) : null,
      };
      entry.ids.push(String(row.id));
      entry.amount += Number(row.amount);
      const dueAt = new Date(String(row.due_at));
      if (dueAt.getTime() > entry.dueAt.getTime()) entry.dueAt = dueAt;
      grouped.set(staffId, entry);
    }

    const payouts: DuePayout[] = [];
    if (grouped.size === 0) return { payouts, runId: null as string | null };

    // Every payout this sweep creates hangs off ONE run awaiting approval. The
    // cadence no longer authorises its own payments; it only proposes them.
    const [run] = await tx`
      INSERT INTO staff_payout_runs
        (venue_id, kind, period_label, status, created_by)
      VALUES (${venue}, 'tips', ${periodLabel}, 'pending_approval', ${actor})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    const [openRun] = run
      ? [run]
      : await tx`
          SELECT id FROM staff_payout_runs
          WHERE venue_id = ${venue} AND kind = 'tips' AND period_label = ${periodLabel}
            AND status NOT IN ('rejected', 'cancelled')
          LIMIT 1`;
    // An already-approved run must not silently absorb newly proposed money.
    if (!openRun) return { payouts, runId: null as string | null };
    const runId = String(openRun.id);

    for (const [staffId, entry] of grouped) {
      if (entry.amount <= 0) continue;
      const ids = [...entry.ids].sort();
      // An allocation belongs to exactly one payout (tip_payout_items is unique
      // on allocation_id), so the lowest allocation id is a stable key for this
      // exact set of money and makes a repeated run a no-op.
      const key = `cadence:${staffId}:${ids[0]}`;
      const heldReason =
        entry.method === "mpesa"
          ? null
          : entry.method === "bank"
            ? "bank_rail_unavailable"
            : "no_payout_details";
      const [payout] = await tx`
        INSERT INTO tip_payouts
          (venue_id, staff_id, amount, idempotency_key, requested_by, status,
           held_reason, scheduled_for, run_id)
        VALUES (${venue}, ${staffId}, ${entry.amount}, ${key}, ${actor},
                ${heldReason ? "held" : "pending"}, ${heldReason}, ${entry.dueAt},
                ${runId})
        ON CONFLICT (venue_id, idempotency_key) DO NOTHING
        RETURNING id, status, amount, held_reason`;
      if (!payout) continue;
      for (const allocationId of ids) {
        await tx`
          INSERT INTO tip_payout_items (payout_id, allocation_id, amount)
          SELECT ${payout.id}, id, amount FROM tip_allocations WHERE id = ${allocationId}
          ON CONFLICT (allocation_id) DO NOTHING`;
      }
      payouts.push({
        id: String(payout.id),
        staffId,
        amount: Number(payout.amount),
        status: String(payout.status),
        heldReason: payout.held_reason ? String(payout.held_reason) : null,
      });
    }

    // The totals a manager approves against must describe what is actually
    // payable, so held lines are excluded from both.
    const payable = payouts.filter((p) => p.status === "pending");
    await tx`
      UPDATE staff_payout_runs
      SET total_amount = total_amount + ${payable.reduce((sum, p) => sum + p.amount, 0)},
          staff_count = staff_count + ${payable.length},
          updated_at = now()
      WHERE id = ${runId}`;
    return { payouts, runId };
  });

  return { created: created.payouts, released: released.length, runId: created.runId };
}
