import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

import {
  allocateFixedTips,
  allocateWeightedTips,
  splitDirectJar,
  type TipAllocationRule,
} from "@/lib/tip-allocation";
import { envVar } from "@/lib/env";
import { postEntryInTransaction, tipPayoutLines } from "@/lib/accounting";
import { verifyToken } from "@/lib/webhook-verify";
import type { QuerySql } from "@/lib/db";
import {
  closeDueWeeks,
  distributeJar,
  effectiveDirectPct,
  isJarMethod,
  isTipModel,
  issueDueTipPayouts,
  loadDirectOverrides,
  loadTipSettings,
  TipDistributionError,
  type VenueTipSettings,
} from "@/lib/tip-distribution";
import {
  currentCollectionWeek,
  jarIsOpen,
  openJarWeek,
  payoutMondayFor,
  tipWeek,
  weeksLateFor,
} from "@/lib/tip-cadence";
import {
  decryptAccountNumber,
  encryptAccountNumber,
  maskedAccount,
  validatePayoutDetails,
} from "@/lib/payout-details";
import {
  maskPhone,
  payoutChallengeMessage,
  payoutOtpPurpose,
  PAYOUT_OTP_MAX_ATTEMPTS,
  PAYOUT_OTP_RATE_LIMIT,
  PAYOUT_OTP_TTL_MS,
  resolveChallengeTarget,
} from "@/lib/payout-challenge";
import { generateOtpCode, hashOtp, normalizeDestination, timingSafeEqualHex } from "@/lib/otp";
import { buildPayoutRequest, mapProviderStatus } from "@/lib/payout-provider";
import {
  canSubmit,
  decideApproval,
  salaryPeriodLabel,
  type PayoutRunKind,
} from "@/lib/payout-runs";
import { planSalaryRun, validateSalary } from "@/lib/payroll";
import { hasVerifiedChannelAccount, queueOutbound } from "@/lib/outbound-jobs";
import { rateLimit } from "@/lib/rate-limit";
import { otpDebugAllowed } from "@/lib/runtime-security";
import { getAuthConfig } from "@/api/auth";

function money(value: unknown): number {
  return Number(value ?? 0);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function staffIdFrom(payload: Record<string, unknown>, url: URL): string | null {
  const fromPayload = payload.staff_id;
  if (typeof fromPayload === "string" && validUuid(fromPayload)) {
    return fromPayload;
  }
  const fromQuery = url.searchParams.get("staff");
  if (roleAtLeast(payload, "manager") && fromQuery && validUuid(fromQuery)) return fromQuery;
  return null;
}

const TIP_PAYMENT_STATUSES = [
  "succeeded",
  "paid",
  "captured",
  "partially_refunded",
  "refunded",
];

const MAX_COLLECTION_DAYS = 92;

type TipCollectionRow = {
  paymentId: string;
  staffId: string | null;
  name: string | null;
  gross: number;
  net: number;
  direct: number;
  jar: number;
  channel: string;
  pooled: boolean;
  createdAt: string;
};

/**
 * Every tipping payment in a window with its direct/jar split. A payment that a
 * weekly pool has already closed uses the SNAPSHOT taken at close, so changing a
 * rule today never rewrites last week's history; anything still open is split
 * with the rules in force right now.
 */
async function tipCollectionRows(
  sql: QuerySql,
  venue: string,
  from: Date,
  to: Date,
  settings: VenueTipSettings,
  overrides: Map<string, number>,
): Promise<TipCollectionRow[]> {
  const rows = await sql`
    SELECT p.id, p.staff_id, s.name, p.created_at,
           p.tip_amount::bigint AS gross_tip,
           GREATEST(0, p.tip_amount - COALESCE((
             SELECT sum(fa.amount) FROM financial_adjustments fa
             WHERE fa.payment_id = p.id AND fa.component = 'tip'
           ), 0))::bigint AS net_tip,
           COALESCE(p.metadata->>'channel', p.metadata->>'source', p.provider, 'qr') AS channel,
           tps.direct_tip, tps.jar_tip,
           (tps.payment_id IS NOT NULL) AS pooled
    FROM payments p
    LEFT JOIN staff s ON s.id = p.staff_id
    LEFT JOIN tip_pool_sources tps
      ON tps.venue_id = p.venue_id AND tps.payment_id = p.id
    WHERE p.venue_id = ${venue} AND p.tip_amount > 0
      AND p.currency = 'KES' AND p.kind <> 'refund'
      AND p.status IN ${sql(TIP_PAYMENT_STATUSES)}
      AND p.created_at >= ${from} AND p.created_at < ${to}
    ORDER BY p.created_at DESC
    LIMIT 20000`;

  return rows.map((row) => {
    const staffId = row.staff_id ? String(row.staff_id) : null;
    const net = Number(row.net_tip ?? 0);
    const pooled = Boolean(row.pooled);
    const split = pooled
      ? { direct: Number(row.direct_tip ?? 0), jar: Number(row.jar_tip ?? 0) }
      : splitDirectJar(
          net,
          staffId ? effectiveDirectPct(settings, overrides.get(staffId)) : 0,
        );
    return {
      paymentId: String(row.id),
      staffId,
      name: row.name ? String(row.name) : null,
      gross: Number(row.gross_tip ?? 0),
      net,
      direct: split.direct,
      jar: split.jar,
      channel: String(row.channel ?? "qr"),
      pooled,
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  });
}

function summariseTipCollection(rows: TipCollectionRow[]) {
  const totals = { gross: 0, net: 0, direct: 0, jar: 0, payments: rows.length };
  const byChannel = new Map<string, { channel: string; net: number; direct: number; jar: number; payments: number }>();
  const byServer = new Map<string, { staffId: string | null; name: string | null; net: number; direct: number; jar: number; payments: number }>();

  for (const row of rows) {
    totals.gross += row.gross;
    totals.net += row.net;
    totals.direct += row.direct;
    totals.jar += row.jar;

    const channel = byChannel.get(row.channel) ?? {
      channel: row.channel,
      net: 0,
      direct: 0,
      jar: 0,
      payments: 0,
    };
    channel.net += row.net;
    channel.direct += row.direct;
    channel.jar += row.jar;
    channel.payments += 1;
    byChannel.set(row.channel, channel);

    const key = row.staffId ?? "unassigned";
    const server = byServer.get(key) ?? {
      staffId: row.staffId,
      name: row.name,
      net: 0,
      direct: 0,
      jar: 0,
      payments: 0,
    };
    server.net += row.net;
    server.direct += row.direct;
    server.jar += row.jar;
    server.payments += 1;
    byServer.set(key, server);
  }

  return {
    totals,
    byChannel: [...byChannel.values()].sort((a, b) => b.net - a.net),
    byServer: [...byServer.values()].sort((a, b) => b.net - a.net),
  };
}

function parseRange(url: URL, fallbackFrom: Date, now: Date): { from: Date; to: Date } | null {
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const from = rawFrom ? new Date(rawFrom) : fallbackFrom;
  const to = rawTo ? new Date(rawTo) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return null;
  if (to.getTime() - from.getTime() > MAX_COLLECTION_DAYS * 24 * 60 * 60 * 1000) return null;
  return { from, to };
}

export async function handleTipsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/tips")) return null;

  // D5.8 — the weekly cadence sweep. Called by the scheduler with the cron
  // secret, or by a manager for their own venue. Guarded before requireAuth so
  // the scheduler never needs a human session.
  if (url.pathname === "/api/tips/weekly/run" && request.method === "POST") {
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const cronSecret = envVar(env, "CRON_SECRET");
    const fromCron =
      Boolean(cronSecret) && verifyToken(request.headers.get("x-cron-secret"), cronSecret!);
    if (fromCron) {
      const venues = await sql`SELECT id FROM venues ORDER BY id`;
      const results = [];
      for (const row of venues) {
        results.push(await runTipCadence(env, String(row.id), "cron"));
      }
      return json({ ok: true, venues: results.length, results });
    }
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    const venue = venueFromPayload(payload, url);
    return json({
      ok: true,
      results: [await runTipCadence(env, venue, String(payload.sub ?? "manager"))],
    });
  }

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/tips" && request.method === "GET") {
    const period = url.searchParams.get("period") ?? "";
    const scope = url.searchParams.get("scope") === "me" ? "me" : "team";
    const staffId = staffIdFrom(payload, url);

    if (scope === "me" && (!staffId || payload.isApiToken === true)) {
      return json({ error: "staff identity required" }, 403);
    }

    if (scope === "team" && (!roleAtLeast(payload, "supervisor") || !tokenHasScope(payload, "tips:read"))) {
      return json({ error: "forbidden" }, 403);
    }

    if (scope === "me" && staffId) {
      const [row] = await sql`
        SELECT coalesce(sum(
                 tip_amount - COALESCE((
                   SELECT sum(fa.amount)
                   FROM financial_adjustments fa
                   WHERE fa.payment_id = payments.id AND fa.component = 'tip'
                 ), 0)
               ), 0)::bigint AS tips,
               count(*)::int AS payments
        FROM payments
        WHERE venue_id = ${venue}
          AND staff_id = ${staffId}
          AND tip_amount > 0
          AND currency = 'KES' AND kind <> 'refund'
          AND status IN ('succeeded','paid','captured','partially_refunded','refunded')
          AND (${period} <> 'today' OR created_at::date = CURRENT_DATE)`;
      const tips = money(row?.tips);
      return json({
        tips: [{ staff_id: staffId, tips, payments: Number(row?.payments ?? 0) }],
        total: tips,
      });
    }

    const tips = await sql`
      SELECT p.staff_id, s.name,
             sum(p.tip_amount - COALESCE((
               SELECT sum(fa.amount)
               FROM financial_adjustments fa
               WHERE fa.payment_id = p.id AND fa.component = 'tip'
             ), 0))::bigint AS tips,
             count(*)::int AS payments
      FROM payments p
      LEFT JOIN staff s ON s.id = p.staff_id
      WHERE p.venue_id = ${venue}
        AND p.tip_amount > 0
        AND p.currency = 'KES' AND p.kind <> 'refund'
        AND p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
        AND (${period} <> 'today' OR p.created_at::date = CURRENT_DATE)
      GROUP BY p.staff_id, s.name
      ORDER BY tips DESC`;
    const rows = tips.map((row) => ({
      ...row,
      tips: money(row.tips),
      payments: Number(row.payments ?? 0),
    }));
    return json({
      tips: rows,
      total: rows.reduce((sum, row) => sum + row.tips, 0),
    });
  }

  if (url.pathname === "/api/tips/pool/run" && request.method === "POST") {
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "tips:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      rule?: TipAllocationRule;
      periodStart?: string;
      periodEnd?: string;
      currency?: string;
      idempotencyKey?: string;
      staffIds?: unknown;
      fixed?: Array<{ staffId?: string; amount?: number }>;
    };
    if (!["direct", "equal", "by_hours", "fixed"].includes(body.rule ?? "")) {
      return json({ error: "rule must be direct, equal, by_hours or fixed" }, 400);
    }
    const rule = body.rule as TipAllocationRule;
    const periodStart = new Date(String(body.periodStart ?? ""));
    const periodEnd = new Date(String(body.periodEnd ?? ""));
    if (
      Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) ||
      periodEnd <= periodStart || periodEnd > new Date()
    ) {
      return json({ error: "A closed periodStart/periodEnd range is required." }, 400);
    }
    const currency = String(body.currency ?? "KES").toUpperCase();
    if (currency !== "KES") return json({ error: "Only KES tip pools are supported." }, 409);
    const idempotencyKey = String(
      body.idempotencyKey ?? request.headers.get("Idempotency-Key") ?? "",
    ).trim();
    if (!idempotencyKey) return json({ error: "Idempotency-Key required" }, 400);
    if (
      Array.isArray(body.staffIds) &&
      body.staffIds.some((id) => typeof id !== "string" || !validUuid(id))
    ) {
      return json({ error: "invalid staffIds" }, 400);
    }
    const requestedIds = Array.isArray(body.staffIds)
      ? body.staffIds.filter(
          (id): id is string => typeof id === "string" && validUuid(id),
        )
      : [];

    try {
      const result = await sql.begin(async (tx) => {
      await tx`
        SELECT pg_advisory_xact_lock(hashtextextended(${`tip-pool:${venue}:${currency}`}, 0))`;
      const [existing] = await tx`
        SELECT id, rule, period_start, period_end, net_tips
        FROM tip_pools WHERE venue_id = ${venue} AND idempotency_key = ${idempotencyKey}`;
      if (existing) return { replay: true, pool: existing, allocations: [] };
      const sources = await tx`
        SELECT fps.payment_id, p.staff_id, fps.tip_amount AS gross_tip,
               GREATEST(0, fps.tip_amount - COALESCE((
                 SELECT sum(fa.amount) FROM financial_adjustments fa
                 WHERE fa.payment_id = fps.payment_id AND fa.component = 'tip'
               ), 0))::bigint AS net_tip
        FROM financial_payment_snapshots fps
        JOIN payments p ON p.id = fps.payment_id AND p.venue_id = fps.venue_id
        WHERE fps.venue_id = ${venue} AND fps.currency = ${currency}
          AND fps.created_at >= ${periodStart} AND fps.created_at < ${periodEnd}
          AND fps.tip_amount > 0
          AND NOT EXISTS (SELECT 1 FROM tip_pool_sources tps
                          WHERE tps.venue_id = ${venue} AND tps.payment_id = fps.payment_id)
        ORDER BY fps.payment_id`;
      const total = sources.reduce((sum, source) => sum + Number(source.net_tip), 0);
      const gross = sources.reduce((sum, source) => sum + Number(source.gross_tip), 0);
      if (total <= 0) throw new Error("no unallocated net tips");
      let allocations: Array<{ staffId: string; amount: number }>;
      if (rule === "direct") {
        const direct = new Map<string, number>();
        for (const source of sources) {
          if (!source.staff_id) throw new Error("direct allocation has unassigned tips");
          const id = String(source.staff_id);
          direct.set(id, (direct.get(id) ?? 0) + Number(source.net_tip));
        }
        allocations = [...direct].map(([staffId, amount]) => ({ staffId, amount }));
      } else if (rule === "fixed") {
        allocations = allocateFixedTips(total, (body.fixed ?? []).map((entry) => ({
          staffId: String(entry.staffId ?? ""),
          amount: Number(entry.amount),
        })));
        const fixedIds = allocations.map((allocation) => allocation.staffId);
        const validStaff = await tx`
          SELECT id FROM staff WHERE venue_id = ${venue} AND active = true
            AND id IN (SELECT unnest(${fixedIds}::uuid[]))`;
        if (validStaff.length !== fixedIds.length) {
          throw new Error("fixed allocations contain staff outside this venue");
        }
      } else {
          const staff = requestedIds.length
          ? await tx`
            SELECT id FROM staff WHERE venue_id = ${venue}
                AND id IN (SELECT unnest(${requestedIds}::uuid[])) ORDER BY id`
          : await tx`SELECT id FROM staff WHERE venue_id = ${venue} AND active = true ORDER BY id`;
        if (!staff.length) throw new Error("no active staff");
        if (requestedIds.length && staff.length !== requestedIds.length) {
          throw new Error("one or more staff do not belong to this venue");
        }
        if (rule === "by_hours") {
          const hours = await tx`
            SELECT staff_id,
                   GREATEST(0, sum(EXTRACT(EPOCH FROM
                     (LEAST(closed_at, ${periodEnd}) - GREATEST(opened_at, ${periodStart})))
                     - break_minutes * 60))::bigint AS seconds
            FROM shifts
            WHERE venue_id = ${venue} AND status = 'closed' AND staff_id IS NOT NULL
              AND opened_at < ${periodEnd} AND closed_at > ${periodStart}
            GROUP BY staff_id`;
          const weights = new Map(hours.map((row) => [String(row.staff_id), Number(row.seconds)]));
          allocations = allocateWeightedTips(total, staff.map((row) => ({
            staffId: String(row.id), weight: weights.get(String(row.id)) ?? 0,
          })));
        } else {
          allocations = allocateWeightedTips(total, staff.map((row) => ({
            staffId: String(row.id), weight: 1,
          })));
        }
      }
      const [pool] = await tx`
        INSERT INTO tip_pools
          (venue_id, rule, period, period_start, period_end, currency,
           gross_tips, refunded_tips, net_tips, created_by, idempotency_key)
        VALUES (${venue}, ${rule}, ${`${periodStart.toISOString()}/${periodEnd.toISOString()}`},
                ${periodStart}, ${periodEnd}, ${currency}, ${gross}, ${gross - total},
                ${total}, ${String(payload.sub ?? "manager")}, ${idempotencyKey})
        RETURNING id, venue_id, rule, period_start, period_end, currency, net_tips, created_at`;
      for (const source of sources) {
        await tx`
          INSERT INTO tip_pool_sources
            (pool_id, venue_id, payment_id, gross_tip, refunded_tip, net_tip, staff_id)
          VALUES (${pool.id}, ${venue}, ${source.payment_id}, ${source.gross_tip},
                  ${Number(source.gross_tip) - Number(source.net_tip)}, ${source.net_tip},
                  ${source.staff_id ?? null})`;
      }
      const rows = [];
      for (const allocation of allocations) {
        const [created] = await tx`
          INSERT INTO tip_allocations
            (pool_id, venue_id, staff_id, amount, period, currency, entry_type)
          VALUES (${pool.id}, ${venue}, ${allocation.staffId}, ${allocation.amount},
                  ${`${periodStart.toISOString()}/${periodEnd.toISOString()}`},
                  ${currency}, 'allocation')
          RETURNING id, pool_id, venue_id, staff_id, amount, period, paid_at, created_at`;
        rows.push({ ...created, amount: money(created.amount) });
      }
      return { replay: false, pool, allocations: rows };
      });
      return json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "tip allocation failed";
      return json({ error: message }, /overlap|conflict/i.test(message) ? 409 : 400);
    }
  }

  if (url.pathname === "/api/tips/report" && request.method === "GET") {
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "tips:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const period = url.searchParams.get("period");
    const pools = await sql`
      SELECT id, venue_id, rule, period, created_at
      FROM tip_pools
      WHERE venue_id = ${venue}
        AND (${period}::text IS NULL OR period = ${period})
      ORDER BY created_at DESC`;
    const allocations = await sql`
      SELECT a.id, a.pool_id, a.venue_id, a.staff_id, s.name, a.amount,
             a.period, a.paid_at, a.created_at
      FROM tip_allocations a
      LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.venue_id = ${venue}
        AND (${period}::text IS NULL OR a.period = ${period})
      ORDER BY a.created_at DESC`;
    return json({
      pools,
      allocations: allocations.map((row) => ({
        ...row,
        amount: money(row.amount),
      })),
    });
  }

  // ---------------------------------------------------------------------
  // D5.1 — Collection. Total tips for a period, split direct-to-server vs jar,
  // and broken down by capture channel and by server.
  // ---------------------------------------------------------------------
  if (url.pathname === "/api/tips/collection" && request.method === "GET") {
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "tips:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const settings = await loadTipSettings(sql, venue);
    const now = new Date();
    const range = parseRange(
      url,
      currentCollectionWeek(now, settings.timeZone).collectionStart,
      now,
    );
    if (!range) {
      return json(
        { error: `Provide a valid from/to range of at most ${MAX_COLLECTION_DAYS} days.` },
        400,
      );
    }
    const overrides = await loadDirectOverrides(sql, venue);
    const rows = await tipCollectionRows(
      sql,
      venue,
      range.from,
      range.to,
      settings,
      overrides,
    );
    return json({
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      model: settings.model,
      timeZone: settings.timeZone,
      ...summariseTipCollection(rows),
    });
  }

  // ---------------------------------------------------------------------
  // D5.2 / D5.8 — Distribution. The jar currently open, what it is worth, when
  // it pays out, and the history of past distributions.
  // ---------------------------------------------------------------------
  if (url.pathname === "/api/tips/jar" && request.method === "GET") {
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "tips:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const settings = await loadTipSettings(sql, venue);
    const now = new Date();
    const requested = url.searchParams.get("week");
    const week =
      requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)
        ? tipWeek(requested, settings.timeZone)
        : openJarWeek(now, settings.timeZone);

    const [pool] = await sql`
      SELECT id, jar_tips, direct_tips, net_tips, distributed_at, distributed_by,
             jar_method, scheduled_payout_at, weeks_late
      FROM tip_pools
      WHERE venue_id = ${venue} AND kind = 'weekly' AND week_start = ${week.weekStart}
      LIMIT 1`;

    // Not yet closed by the cadence run: value the jar live so the manager is
    // never looking at a blank screen while the sweep catches up.
    let available = pool ? Number(pool.jar_tips) : 0;
    if (!pool) {
      const overrides = await loadDirectOverrides(sql, venue);
      const rows = await tipCollectionRows(
        sql,
        venue,
        week.collectionStart,
        week.collectionEnd,
        settings,
        overrides,
      );
      available = rows.reduce((sum, row) => sum + row.jar, 0);
    }

    const history = await sql`
      SELECT tp.id, to_char(tp.week_start, 'YYYY-MM-DD') AS week_start,
             tp.jar_tips, tp.direct_tips, tp.distributed_at, tp.distributed_by,
             tp.jar_method, tp.scheduled_payout_at, tp.weeks_late,
             (SELECT count(*)::int FROM tip_allocations a
              WHERE a.pool_id = tp.id AND a.stream = 'jar') AS recipients
      FROM tip_pools tp
      WHERE tp.venue_id = ${venue} AND tp.kind = 'weekly' AND tp.distributed_at IS NOT NULL
      ORDER BY tp.week_start DESC
      LIMIT 12`;

    // D5.10 (substituted) — Sunday warns when a server has no POS account. We
    // have no POS, so we warn on the thing that actually blocks the payout here.
    const unbanked = await sql`
      SELECT s.id, s.name FROM staff s
      LEFT JOIN staff_payout_details d ON d.venue_id = s.venue_id AND d.staff_id = s.id
      WHERE s.venue_id = ${venue} AND s.active = true AND d.id IS NULL
      ORDER BY s.name`;

    return json({
      model: settings.model,
      jarMethod: settings.jarMethod,
      timeZone: settings.timeZone,
      week: {
        weekStart: week.weekStart,
        collectionStart: week.collectionStart.toISOString(),
        collectionEnd: week.collectionEnd.toISOString(),
        opensAt: week.opensAt.toISOString(),
        onTimeDeadline: week.onTimeDeadline.toISOString(),
        scheduledPayoutAt: week.scheduledPayoutAt.toISOString(),
      },
      isOpen: jarIsOpen(week, now),
      available,
      distributed: pool?.distributed_at
        ? {
            at: new Date(String(pool.distributed_at)).toISOString(),
            by: pool.distributed_by ? String(pool.distributed_by) : null,
            method: pool.jar_method ? String(pool.jar_method) : null,
            scheduledPayoutAt: pool.scheduled_payout_at
              ? new Date(String(pool.scheduled_payout_at)).toISOString()
              : null,
            weeksLate: pool.weeks_late == null ? null : Number(pool.weeks_late),
          }
        : null,
      payoutIfDistributedNow: payoutMondayFor(now, settings.timeZone).toISOString(),
      weeksLateIfDistributedNow: weeksLateFor(week, now, settings.timeZone),
      history: history.map((row) => ({
        poolId: String(row.id),
        weekStart: String(row.week_start),
        jarTips: Number(row.jar_tips ?? 0),
        directTips: Number(row.direct_tips ?? 0),
        distributedAt: new Date(String(row.distributed_at)).toISOString(),
        distributedBy: row.distributed_by ? String(row.distributed_by) : null,
        method: row.jar_method ? String(row.jar_method) : null,
        scheduledPayoutAt: row.scheduled_payout_at
          ? new Date(String(row.scheduled_payout_at)).toISOString()
          : null,
        weeksLate: row.weeks_late == null ? null : Number(row.weeks_late),
        recipients: Number(row.recipients ?? 0),
      })),
      unbankedStaff: unbanked.map((row) => ({
        staffId: String(row.id),
        name: String(row.name ?? ""),
      })),
    });
  }

  // D5.6 / D5.3 / D5.4 — distribute the jar. Money movement: manager+, always.
  if (url.pathname === "/api/tips/jar/distribute" && request.method === "POST") {
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "tips:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      weekStart?: unknown;
      method?: unknown;
      entries?: unknown;
      staffIds?: unknown;
      idempotencyKey?: unknown;
    };
    const idempotencyKey = String(
      (typeof body.idempotencyKey === "string" ? body.idempotencyKey : "") ||
        request.headers.get("Idempotency-Key") ||
        "",
    ).trim();
    if (!idempotencyKey) return json({ error: "Idempotency-Key required" }, 400);
    if (!isJarMethod(body.method)) {
      return json({ error: "method must be by_hours or fixed" }, 400);
    }
    const weekStart =
      typeof body.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)
        ? body.weekStart
        : null;
    if (typeof body.weekStart === "string" && !weekStart) {
      return json({ error: "weekStart must be a YYYY-MM-DD Monday" }, 400);
    }
    let entries: Array<{ staffId: string; amount: number }> | undefined;
    if (body.method === "fixed") {
      if (!Array.isArray(body.entries) || body.entries.length === 0) {
        return json({ error: "fixed distribution needs an amount per employee" }, 400);
      }
      entries = [];
      for (const raw of body.entries) {
        const entry = raw as { staffId?: unknown; amount?: unknown };
        if (typeof entry.staffId !== "string" || !validUuid(entry.staffId)) {
          return json({ error: "invalid staffId in entries" }, 400);
        }
        const amount = Number(entry.amount);
        if (!Number.isInteger(amount) || amount < 0) {
          return json({ error: "entry amounts must be whole minor units" }, 400);
        }
        entries.push({ staffId: entry.staffId, amount });
      }
    }
    let staffIds: string[] | undefined;
    if (Array.isArray(body.staffIds)) {
      if (body.staffIds.some((id) => typeof id !== "string" || !validUuid(id))) {
        return json({ error: "invalid staffIds" }, 400);
      }
      staffIds = body.staffIds as string[];
    }

    const settings = await loadTipSettings(sql, venue);
    if (settings.model === "direct") {
      return json(
        { error: "This venue pays 100% direct to servers — there is no tip jar to distribute." },
        409,
      );
    }
    try {
      const result = await distributeJar(sql, settings, {
        venue,
        weekStart,
        method: body.method,
        entries,
        staffIds,
        idempotencyKey,
        actor: String(payload.sub ?? "manager"),
        now: new Date(),
      });
      return json(result, result.replay ? 200 : 201);
    } catch (error) {
      if (error instanceof TipDistributionError) {
        return json({ error: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "distribution failed";
      return json({ error: message }, 400);
    }
  }

  // ---------------------------------------------------------------------
  // D5.9 / D5.10 / D5.11 — Rules. Per-server direct vs jar percentages, whether
  // each server can actually be paid, and their distribution history.
  // ---------------------------------------------------------------------
  if (url.pathname === "/api/tips/rules" && request.method === "GET") {
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "tips:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const settings = await loadTipSettings(sql, venue);
    const overrides = await loadDirectOverrides(sql, venue);

    const focus = url.searchParams.get("staff");
    if (focus && validUuid(focus)) {
      const history = await sql`
        SELECT a.id, a.amount, a.stream, a.created_at, a.paid_at,
               to_char(tp.week_start, 'YYYY-MM-DD') AS week_start,
               po.status AS payout_status, po.scheduled_for, po.held_reason
        FROM tip_allocations a
        LEFT JOIN tip_pools tp ON tp.id = a.pool_id
        LEFT JOIN tip_payout_items i ON i.allocation_id = a.id
        LEFT JOIN tip_payouts po ON po.id = i.payout_id
        WHERE a.venue_id = ${venue} AND a.staff_id = ${focus}
        ORDER BY a.created_at DESC
        LIMIT 100`;
      return json({
        staffId: focus,
        history: history.map((row) => ({
          id: String(row.id),
          amount: money(row.amount),
          stream: String(row.stream),
          weekStart: row.week_start ? String(row.week_start) : null,
          createdAt: new Date(String(row.created_at)).toISOString(),
          payoutStatus: row.payout_status ? String(row.payout_status) : null,
          scheduledFor: row.scheduled_for
            ? new Date(String(row.scheduled_for)).toISOString()
            : null,
          heldReason: row.held_reason ? String(row.held_reason) : null,
        })),
      });
    }

    const servers = await sql`
      SELECT s.id, s.name, s.role, s.active,
             d.method AS payout_method, d.account_last4, d.bank_name, d.account_name,
             (SELECT max(po.confirmed_at) FROM tip_payouts po
              WHERE po.venue_id = s.venue_id AND po.staff_id = s.id
                AND po.status = 'confirmed') AS last_paid_at,
             COALESCE((SELECT sum(a.amount) FROM tip_allocations a
                       WHERE a.venue_id = s.venue_id AND a.staff_id = s.id
                         AND a.stream = 'direct'), 0)::bigint AS lifetime_direct,
             COALESCE((SELECT sum(a.amount) FROM tip_allocations a
                       WHERE a.venue_id = s.venue_id AND a.staff_id = s.id
                         AND a.stream = 'jar'), 0)::bigint AS lifetime_jar
      FROM staff s
      LEFT JOIN staff_payout_details d ON d.venue_id = s.venue_id AND d.staff_id = s.id
      WHERE s.venue_id = ${venue}
      ORDER BY s.active DESC, s.name`;

    return json({
      settings: {
        model: settings.model,
        defaultDirectPct: settings.defaultDirectPct,
        jarMethod: settings.jarMethod,
        timeZone: settings.timeZone,
      },
      servers: servers.map((row) => {
        const staffId = String(row.id);
        const override = overrides.get(staffId);
        const directPct = effectiveDirectPct(settings, override);
        return {
          staffId,
          name: String(row.name ?? ""),
          role: String(row.role ?? "Server"),
          active: Boolean(row.active),
          directPct,
          jarPct: 100 - directPct,
          source: settings.model === "split" && override != null ? "override" : "venue",
          // Managers see the tail only — never the account number itself.
          payoutMethod: row.payout_method ? String(row.payout_method) : null,
          payoutAccount: row.account_last4 ? maskedAccount(String(row.account_last4)) : null,
          payoutBank: row.bank_name ? String(row.bank_name) : null,
          canBePaid: String(row.payout_method ?? "") === "mpesa",
          lastPaidAt: row.last_paid_at
            ? new Date(String(row.last_paid_at)).toISOString()
            : null,
          lifetimeDirect: money(row.lifetime_direct),
          lifetimeJar: money(row.lifetime_jar),
        };
      }),
    });
  }

  if (url.pathname === "/api/tips/rules" && request.method === "PUT") {
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "tips:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      model?: unknown;
      defaultDirectPct?: unknown;
      jarMethod?: unknown;
      servers?: unknown;
    };
    const known = new Set(["model", "defaultDirectPct", "jarMethod", "servers"]);
    if (Object.keys(body).some((key) => !known.has(key))) {
      return json({ error: "unknown field" }, 400);
    }
    const current = await loadTipSettings(sql, venue);
    const model = body.model === undefined ? current.model : body.model;
    if (!isTipModel(model)) return json({ error: "model must be direct, jar or split" }, 400);
    const jarMethod = body.jarMethod === undefined ? current.jarMethod : body.jarMethod;
    if (!isJarMethod(jarMethod)) {
      return json({ error: "jarMethod must be by_hours or fixed" }, 400);
    }
    const defaultDirectPct =
      body.defaultDirectPct === undefined
        ? current.defaultDirectPct
        : Number(body.defaultDirectPct);
    if (!Number.isInteger(defaultDirectPct) || defaultDirectPct < 0 || defaultDirectPct > 100) {
      return json({ error: "defaultDirectPct must be a whole number 0-100" }, 400);
    }
    const servers: Array<{ staffId: string; directPct: number }> = [];
    if (body.servers !== undefined) {
      if (!Array.isArray(body.servers)) return json({ error: "servers must be a list" }, 400);
      for (const raw of body.servers) {
        const entry = raw as { staffId?: unknown; directPct?: unknown };
        if (typeof entry.staffId !== "string" || !validUuid(entry.staffId)) {
          return json({ error: "invalid staffId" }, 400);
        }
        const directPct = Number(entry.directPct);
        if (!Number.isInteger(directPct) || directPct < 0 || directPct > 100) {
          return json({ error: "directPct must be a whole number 0-100" }, 400);
        }
        servers.push({ staffId: entry.staffId, directPct });
      }
      if (servers.length) {
        const ids = servers.map((server) => server.staffId);
        const valid = await sql`
          SELECT id FROM staff WHERE venue_id = ${venue}
            AND id IN (SELECT unnest(${ids}::uuid[]))`;
        if (valid.length !== new Set(ids).size) {
          return json({ error: "one or more staff do not belong to this venue" }, 400);
        }
      }
    }

    const actor = String(payload.sub ?? "manager");
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO venue_tip_settings (venue_id, model, default_direct_pct, jar_method)
        VALUES (${venue}, ${model}, ${defaultDirectPct}, ${jarMethod})
        ON CONFLICT (venue_id) DO UPDATE
        SET model = EXCLUDED.model,
            default_direct_pct = EXCLUDED.default_direct_pct,
            jar_method = EXCLUDED.jar_method,
            updated_at = now()`;
      for (const server of servers) {
        await tx`
          INSERT INTO staff_tip_rules (venue_id, staff_id, direct_pct, updated_by)
          VALUES (${venue}, ${server.staffId}, ${server.directPct}, ${actor})
          ON CONFLICT (venue_id, staff_id) DO UPDATE
          SET direct_pct = EXCLUDED.direct_pct,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()`;
      }
    });

    return json({
      ok: true,
      settings: { model, defaultDirectPct, jarMethod },
      updatedServers: servers.length,
    });
  }

  // ---------------------------------------------------------------------
  // B4.1 / B4.2 / B4.3 / B4.4 — a staff member's OWN earnings page. Nobody can
  // read or write someone else's row here, including a manager.
  // ---------------------------------------------------------------------
  if (url.pathname === "/api/tips/me" && request.method === "GET") {
    if (payload.isApiToken === true) return json({ error: "human session required" }, 403);
    const me = typeof payload.staff_id === "string" && validUuid(payload.staff_id)
      ? payload.staff_id
      : null;
    if (!me) return json({ error: "This session is not linked to a staff member." }, 403);
    const [staffRow] = await sql`
      SELECT id, phone FROM staff WHERE id = ${me} AND venue_id = ${venue} LIMIT 1`;
    if (!staffRow) return json({ error: "forbidden" }, 403);

    const settings = await loadTipSettings(sql, venue);
    const [details] = await sql`
      SELECT method, account_name, bank_name, account_last4, updated_at,
             confirmed_via_phone, confirmed_at
      FROM staff_payout_details WHERE venue_id = ${venue} AND staff_id = ${me} LIMIT 1`;

    const [balance] = await sql`
      SELECT
        COALESCE(sum(a.amount) FILTER (WHERE i.allocation_id IS NULL), 0)::bigint AS unpaid,
        COALESCE(sum(a.amount) FILTER (WHERE po.status = 'held'), 0)::bigint AS held,
        COALESCE(sum(a.amount) FILTER (WHERE po.status = 'confirmed'), 0)::bigint AS paid
      FROM tip_allocations a
      LEFT JOIN tip_payout_items i ON i.allocation_id = a.id
      LEFT JOIN tip_payouts po ON po.id = i.payout_id
      WHERE a.venue_id = ${venue} AND a.staff_id = ${me} AND a.entry_type = 'allocation'`;

    const ledger = await sql`
      SELECT a.id, a.amount, a.stream, a.created_at,
             to_char(tp.week_start, 'YYYY-MM-DD') AS week_start,
             po.status AS payout_status, po.scheduled_for, po.held_reason
      FROM tip_allocations a
      LEFT JOIN tip_pools tp ON tp.id = a.pool_id
      LEFT JOIN tip_payout_items i ON i.allocation_id = a.id
      LEFT JOIN tip_payouts po ON po.id = i.payout_id
      WHERE a.venue_id = ${venue} AND a.staff_id = ${me}
      ORDER BY a.created_at DESC
      LIMIT 50`;

    const payouts = await sql`
      SELECT id, amount, status, held_reason, scheduled_for, confirmed_at, created_at
      FROM tip_payouts
      WHERE venue_id = ${venue} AND staff_id = ${me}
      ORDER BY created_at DESC
      LIMIT 25`;

    // B4.4 — personal performance over the trailing 30 days.
    const [performance] = await sql`
      SELECT count(*)::int AS transactions,
             COALESCE(sum(p.amount - COALESCE(p.tip_amount, 0)), 0)::bigint AS revenue,
             COALESCE(sum(p.tip_amount), 0)::bigint AS tips
      FROM payments p
      WHERE p.venue_id = ${venue} AND p.staff_id = ${me}
        AND p.currency = 'KES' AND p.kind <> 'refund'
        AND p.status IN ${sql(TIP_PAYMENT_STATUSES)}
        AND p.created_at >= now() - interval '30 days'`;
    const [reviewRow] = await sql`
      SELECT count(*)::int AS reviews, COALESCE(avg(rating), 0)::float8 AS avg_rating
      FROM reviews
      WHERE venue_id = ${venue} AND staff_id = ${me}
        AND created_at >= now() - interval '30 days'`;

    const revenue = money(performance?.revenue);
    const tips = money(performance?.tips);
    const transactions = Number(performance?.transactions ?? 0);

    return json({
      staffId: me,
      model: settings.model,
      timeZone: settings.timeZone,
      payoutDetails: details
        ? {
            method: String(details.method),
            accountName: String(details.account_name),
            bankName: details.bank_name ? String(details.bank_name) : null,
            account: maskedAccount(String(details.account_last4)),
            updatedAt: new Date(String(details.updated_at)).toISOString(),
            confirmedVia: details.confirmed_via_phone
              ? maskPhone(String(details.confirmed_via_phone))
              : null,
            confirmedAt: details.confirmed_at
              ? new Date(String(details.confirmed_at)).toISOString()
              : null,
          }
        : null,
      needsPayoutDetails: !details,
      // Told up front, so nobody types their bank details only to discover at the
      // last step that no code can reach them.
      confirmation: (() => {
        const target = resolveChallengeTarget(
          staffRow.phone as string | null,
          normalizeDestination,
        );
        return target.ok
          ? { ready: true as const, phone: maskPhone(target.phone), reason: null }
          : { ready: false as const, phone: null, reason: target.reason };
      })(),
      balance: {
        unpaid: money(balance?.unpaid),
        held: money(balance?.held),
        paid: money(balance?.paid),
      },
      ledger: ledger.map((row) => ({
        id: String(row.id),
        amount: money(row.amount),
        stream: String(row.stream),
        weekStart: row.week_start ? String(row.week_start) : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
        payoutStatus: row.payout_status ? String(row.payout_status) : null,
        scheduledFor: row.scheduled_for
          ? new Date(String(row.scheduled_for)).toISOString()
          : null,
        heldReason: row.held_reason ? String(row.held_reason) : null,
      })),
      payouts: payouts.map((row) => ({
        id: String(row.id),
        amount: money(row.amount),
        status: String(row.status),
        heldReason: row.held_reason ? String(row.held_reason) : null,
        scheduledFor: row.scheduled_for
          ? new Date(String(row.scheduled_for)).toISOString()
          : null,
        confirmedAt: row.confirmed_at
          ? new Date(String(row.confirmed_at)).toISOString()
          : null,
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
      performance: {
        windowDays: 30,
        transactions,
        revenue,
        tips,
        tipRatePct: revenue > 0 ? Math.round((tips / revenue) * 1000) / 10 : 0,
        averageTicket: transactions > 0 ? Math.round(revenue / transactions) : 0,
        reviews: Number(reviewRow?.reviews ?? 0),
        averageRating: Math.round(Number(reviewRow?.avg_rating ?? 0) * 10) / 10,
        // Adoption % compares guests who scanned against guests who paid on the
        // POS check. It stays null until the POS connector (C5) exists.
        adoptionRatePct: null,
        adoptionBlockedBy: "C5",
      },
    });
  }

  // B4.1 — step 1 of changing a payout destination: prove you hold the phone on
  // your own staff record. The number is read from the database and never from
  // the request, otherwise an attacker with a borrowed session would simply send
  // the code to themselves.
  if (
    url.pathname === "/api/tips/me/payout-details/challenge" &&
    request.method === "POST"
  ) {
    if (payload.isApiToken === true) return json({ error: "human session required" }, 403);
    const me = typeof payload.staff_id === "string" && validUuid(payload.staff_id)
      ? payload.staff_id
      : null;
    if (!me) return json({ error: "This session is not linked to a staff member." }, 403);
    const [staffRow] = await sql`
      SELECT id, phone FROM staff
      WHERE id = ${me} AND venue_id = ${venue} AND active = true LIMIT 1`;
    if (!staffRow) return json({ error: "forbidden" }, 403);

    const target = resolveChallengeTarget(
      staffRow.phone as string | null,
      normalizeDestination,
    );
    if (!target.ok) {
      // Deliberately not self-serviceable: if staff could supply the number, the
      // check would prove nothing. A manager must correct the staff record.
      return json(
        {
          error:
            target.reason === "no-phone"
              ? "Your staff record has no phone number. Ask your manager to add it before changing payout details."
              : "The phone number on your staff record isn't a valid mobile number. Ask your manager to correct it.",
          code: target.reason,
        },
        409,
      );
    }

    const cfg = await getAuthConfig(env);
    if (!cfg) return json({ error: "auth unavailable" }, 503);

    const rl = await rateLimit(
      env,
      `payout-otp:${me}`,
      PAYOUT_OTP_RATE_LIMIT,
      3600,
    );
    if (rl.limited) {
      return json({ error: "Too many codes requested. Try again later." }, 429);
    }

    const purpose = payoutOtpPurpose(me);
    // One live code at a time, so an older SMS can't be used after the staff
    // member has asked for a fresh one.
    await sql`
      UPDATE auth_otps SET consumed_at = now()
      WHERE purpose = ${purpose} AND consumed_at IS NULL`;

    const code = generateOtpCode();
    const id = `otp_${crypto.randomUUID().replace(/-/g, "")}`;
    const codeHash = await hashOtp(code, target.phone, cfg.secret);
    const expires = new Date(Date.now() + PAYOUT_OTP_TTL_MS).toISOString();
    await sql`
      INSERT INTO auth_otps (id, channel, destination, code_hash, purpose, expires_at)
      VALUES (${id}, 'whatsapp', ${target.phone}, ${codeHash}, ${purpose}, ${expires})`;

    // WhatsApp is the intended rail; SMS is the fallback when a venue has not
    // connected WhatsApp. Both go to the same database-held number, so the
    // security property is identical either way.
    const message = payoutChallengeMessage(code, target.phone.slice(-4));
    let sentVia: "whatsapp" | "sms" | null = null;
    for (const channel of ["whatsapp", "sms"] as const) {
      if (!(await hasVerifiedChannelAccount(env, venue, channel))) continue;
      try {
        await queueOutbound(env, {
          deliveryKey: `payout-otp:${id}`,
          venue,
          sourceType: "authentication",
          sourceId: id,
          channel,
          handle: target.phone,
          purpose: "authentication",
          body: message,
        });
        sentVia = channel;
        break;
      } catch {
        // Try the next rail.
      }
    }

    const debug = otpDebugAllowed(env);
    if (!sentVia && !debug) {
      await sql`UPDATE auth_otps SET consumed_at = now() WHERE id = ${id}`;
      return json(
        {
          error:
            "This venue has no verified WhatsApp or SMS sender, so a confirmation code can't be delivered. Ask your manager to connect one.",
          code: "no-channel",
        },
        503,
      );
    }

    return json({
      sent: true,
      channel: sentVia,
      sentTo: maskPhone(target.phone),
      expiresInSeconds: Math.floor(PAYOUT_OTP_TTL_MS / 1000),
      ...(debug ? { devCode: code } : {}),
    });
  }

  // B4.1 — a staff member adds or changes their OWN payout destination.
  if (url.pathname === "/api/tips/me/payout-details" && request.method === "PUT") {
    if (payload.isApiToken === true) return json({ error: "human session required" }, 403);
    const me = typeof payload.staff_id === "string" && validUuid(payload.staff_id)
      ? payload.staff_id
      : null;
    if (!me) return json({ error: "This session is not linked to a staff member." }, 403);
    const [staffRow] = await sql`
      SELECT id, phone FROM staff
      WHERE id = ${me} AND venue_id = ${venue} AND active = true LIMIT 1`;
    if (!staffRow) return json({ error: "forbidden" }, 403);

    const secret = envVar(env, "STAFF_PAYOUT_KEY");
    if (!secret) {
      return json(
        { error: "Payout details cannot be stored yet — STAFF_PAYOUT_KEY is not configured." },
        503,
      );
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const known = new Set(["method", "accountName", "bankName", "accountNumber", "code"]);
    if (Object.keys(body).some((key) => !known.has(key))) {
      return json({ error: "unknown field" }, 400);
    }

    // Step 2: the code must match one issued for THIS staff member, and it must
    // have been delivered to the phone currently on their record. Re-resolving
    // the target here means a phone changed after the code was issued
    // invalidates it, rather than confirming against a stale number.
    const target = resolveChallengeTarget(
      staffRow.phone as string | null,
      normalizeDestination,
    );
    if (!target.ok) {
      return json(
        { error: "Your staff record has no usable phone number. Ask your manager to fix it.", code: target.reason },
        409,
      );
    }
    const submitted = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(submitted)) {
      return json(
        { error: "A 6-digit confirmation code is required.", code: "confirmation-required" },
        401,
      );
    }
    const cfg = await getAuthConfig(env);
    if (!cfg) return json({ error: "auth unavailable" }, 503);
    const purpose = payoutOtpPurpose(me);
    const [otp] = await sql`
      SELECT id, code_hash, attempts FROM auth_otps
      WHERE purpose = ${purpose} AND destination = ${target.phone}
        AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`;
    if (!otp) {
      return json(
        { error: "That code has expired. Request a new one.", code: "confirmation-required" },
        401,
      );
    }
    if (Number(otp.attempts) >= PAYOUT_OTP_MAX_ATTEMPTS) {
      await sql`UPDATE auth_otps SET consumed_at = now() WHERE id = ${otp.id}`;
      return json({ error: "Too many attempts. Request a new code." }, 429);
    }
    const expected = await hashOtp(submitted, target.phone, cfg.secret);
    if (!timingSafeEqualHex(expected, String(otp.code_hash))) {
      await sql`UPDATE auth_otps SET attempts = attempts + 1 WHERE id = ${otp.id}`;
      return json({ error: "Incorrect code." }, 401);
    }

    let validated;
    try {
      validated = validatePayoutDetails({
        method: body.method as never,
        accountName: String(body.accountName ?? ""),
        bankName: body.bankName == null ? null : String(body.bankName),
        accountNumber: String(body.accountNumber ?? ""),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "invalid details" }, 400);
    }

    let cipher: string;
    try {
      cipher = await encryptAccountNumber(secret, validated.accountNumber);
    } catch {
      return json({ error: "Payout details could not be secured. Contact support." }, 503);
    }

    // Burn the code only once the write is certain to be attempted, so a
    // validation failure doesn't cost the staff member their code.
    await sql`UPDATE auth_otps SET consumed_at = now() WHERE id = ${otp.id}`;

    await sql`
      INSERT INTO staff_payout_details
        (venue_id, staff_id, method, account_name, bank_name, account_cipher,
         account_last4, confirmed_via_phone, confirmed_at)
      VALUES (${venue}, ${me}, ${validated.method}, ${validated.accountName},
              ${validated.bankName}, ${cipher}, ${validated.last4},
              ${target.phone}, now())
      ON CONFLICT (venue_id, staff_id) DO UPDATE
      SET method = EXCLUDED.method,
          account_name = EXCLUDED.account_name,
          bank_name = EXCLUDED.bank_name,
          account_cipher = EXCLUDED.account_cipher,
          account_last4 = EXCLUDED.account_last4,
          confirmed_via_phone = EXCLUDED.confirmed_via_phone,
          confirmed_at = EXCLUDED.confirmed_at,
          updated_at = now()`;

    // Anything we were holding for this person can now move (B4.2).
    const released = await sql`
      UPDATE tip_payouts SET status = 'pending', held_reason = NULL
      WHERE venue_id = ${venue} AND staff_id = ${me} AND status = 'held'
        AND ${validated.method} = 'mpesa'
      RETURNING id`;

    return json({
      ok: true,
      payoutDetails: {
        method: validated.method,
        accountName: validated.accountName,
        bankName: validated.bankName,
        account: maskedAccount(validated.last4),
        confirmedVia: maskPhone(target.phone),
      },
      releasedPayouts: released.length,
    });
  }

  // A payout request is not transfer evidence. It remains pending until a
  // separately verified provider transfer event confirms it.
  if (url.pathname === "/api/tips/payout" && request.method === "POST") {
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!["manager", "merchant", "admin"].includes(role)) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { period?: string };
    const key = request.headers.get("Idempotency-Key")?.trim();
    if (!key) return json({ error: "Idempotency-Key required" }, 400);
    const period = typeof body.period === "string" ? body.period.trim() : "";
    const result = await sql.begin(async (tx) => {
      await tx`
        SELECT pg_advisory_xact_lock(hashtextextended(${`tip-payout:${venue}`}, 0))`;
      const [existing] = await tx`
        SELECT id, status, amount FROM tip_payouts
        WHERE venue_id = ${venue} AND idempotency_key = ${key}`;
      if (existing) return existing;
      const allocations = await tx`
        SELECT a.id, a.staff_id, a.amount,
               d.method AS payout_method
        FROM tip_allocations a
        JOIN staff s ON s.id = a.staff_id AND s.venue_id = a.venue_id
        LEFT JOIN staff_payout_details d
          ON d.venue_id = a.venue_id AND d.staff_id = a.staff_id
        WHERE a.venue_id = ${venue}
          AND (${period} = '' OR a.period = ${period})
          AND NOT EXISTS (SELECT 1 FROM tip_payout_items tpi WHERE tpi.allocation_id = a.id)
        FOR UPDATE OF a`;
      const total = allocations.reduce((sum, row) => sum + money(row.amount), 0);
      if (total <= 0) return null;
      type PayoutAllocation = {
        id: string;
        staff_id: string;
        amount: number | string;
        payout_method: string | null;
      };
      const grouped = new Map<string, PayoutAllocation[]>();
      for (const allocation of allocations) {
        const staffId = String(allocation.staff_id ?? "");
        if (!staffId) throw new Error("unassigned allocation cannot be paid");
        grouped.set(staffId, [
          ...(grouped.get(staffId) ?? []),
          allocation as unknown as PayoutAllocation,
        ]);
      }
      const payouts: Array<{ id: string; status: string; amount: number; staffId: string }> = [];
      for (const [staffId, items] of grouped) {
        const staffTotal = items.reduce((sum, item) => sum + money(item.amount), 0);
        if (staffTotal <= 0) continue;
        // B4.2 — with no usable destination the money is HELD against the
        // allocations, never dropped, and released once details arrive.
        const method = items[0].payout_method;
        const heldReason =
          method === "mpesa" ? null : method === "bank" ? "bank_rail_unavailable" : "no_payout_details";
        const [payout] = await tx`
          INSERT INTO tip_payouts
            (venue_id, staff_id, amount, idempotency_key, requested_by, status, held_reason)
          VALUES (${venue}, ${staffId}, ${staffTotal}, ${`${key}:${staffId}`},
                  ${String(payload.sub ?? "manager")},
                  ${heldReason ? "held" : "pending"}, ${heldReason})
          ON CONFLICT (venue_id, idempotency_key) DO NOTHING
          RETURNING id, status, amount`;
        if (!payout) continue;
        for (const allocation of items) {
          await tx`
            INSERT INTO tip_payout_items (payout_id, allocation_id, amount)
            VALUES (${payout.id}, ${allocation.id}, ${allocation.amount})
            ON CONFLICT (allocation_id) DO NOTHING`;
        }
        payouts.push({
          id: String(payout.id),
          status: String(payout.status),
          amount: Number(payout.amount),
          staffId,
        });
      }
      return { id: payouts[0]?.id, status: "pending", amount: total, payouts };
    });
    if (!result) return json({ error: "no unpaid allocations" }, 409);
    const submission = await submitTipPayouts(env, venue);
    return json({ ok: true, payout: result, submission }, 202);
  }

  return null;
}

/**
 * Push every `pending` payout for a venue to the provider. The destination comes
 * from the staff member's own payout details and nowhere else — a contact phone
 * number on the staff record is not a verified payout instruction. Anything
 * without a usable destination flips back to `held`.
 */
export async function submitTipPayouts(
  env: unknown,
  venue: string,
  limit = 50,
): Promise<{ submitted: number; held: number; skipped: string | null }> {
  const sql = getSql(env);
  if (!sql) return { submitted: 0, held: 0, skipped: "database-unavailable" };
  const apiKey = envVar(env, "PESASWAP_API_KEY");
  const baseUrl = envVar(env, "PESASWAP_URL") || "https://api.pesaswap.io";
  const profileId = envVar(env, "PESASWAP_PROFILE_ID");
  const secret = envVar(env, "STAFF_PAYOUT_KEY");

  // The approval gate. A payout with no approved run is not submitted — that
  // includes every payout the weekly cadence creates, which used to go straight
  // to the provider on a cron with nobody authorising it.
  const pending = await sql`
    SELECT po.id, po.staff_id, po.amount, po.idempotency_key,
           d.method AS payout_method, d.account_cipher, d.bank_code
    FROM tip_payouts po
    JOIN staff_payout_runs r ON r.id = po.run_id
    LEFT JOIN staff_payout_details d
      ON d.venue_id = po.venue_id AND d.staff_id = po.staff_id
    WHERE po.venue_id = ${venue} AND po.status = 'pending'
      AND r.status IN ('approved', 'submitted')
    ORDER BY po.created_at
    LIMIT ${limit}`;
  if (!pending.length) return { submitted: 0, held: 0, skipped: null };

  let submitted = 0;
  let held = 0;
  for (const row of pending) {
    const method = row.payout_method ? String(row.payout_method) : null;
    let accountNumber: string | null = null;
    if ((method === "mpesa" || method === "bank") && secret && row.account_cipher) {
      try {
        accountNumber = await decryptAccountNumber(secret, String(row.account_cipher));
      } catch {
        accountNumber = null;
      }
    }
    const request =
      accountNumber && (method === "mpesa" || method === "bank")
        ? buildPayoutRequest({
            destination:
              method === "mpesa"
                ? { method: "mpesa", accountNumber }
                : {
                    method: "bank",
                    accountNumber,
                    bankCode: row.bank_code ? String(row.bank_code) : null,
                  },
            amountMinor: Number(row.amount),
            profileId: profileId ?? "",
            metadata: {
              tip_payout_id: String(row.id),
              venue_id: venue,
              staff_id: String(row.staff_id),
            },
          })
        : ({ ok: false, heldReason: "no_payout_details" } as const);

    if (!request.ok) {
      await sql`
        UPDATE tip_payouts
        SET status = 'held', held_reason = ${request.heldReason}
        WHERE id = ${row.id} AND status = 'pending'`;
      held += 1;
      continue;
    }
    if (!apiKey || !profileId) continue;
    try {
      const provider = await fetch(`${baseUrl}/payouts/create`, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "Idempotency-Key": String(row.idempotency_key),
        },
        body: JSON.stringify(request.body),
      });
      const providerBody = (await provider.json().catch(() => ({}))) as Record<string, unknown>;
      const providerId = String(providerBody.payout_id ?? "");
      const providerStatus = mapProviderStatus(String(providerBody.status ?? "unknown"));
      await sql`
        UPDATE tip_payouts
        SET status = ${providerStatus}, provider_ref = ${providerId || null}
        WHERE id = ${row.id}`;
      submitted += 1;
    } catch {
      await sql`UPDATE tip_payouts SET status = 'unknown' WHERE id = ${row.id}`;
    }
  }
  if (submitted > 0) {
    await sql`
      UPDATE staff_payout_runs SET status = 'submitted', submitted_at = COALESCE(submitted_at, now()),
             updated_at = now()
      WHERE venue_id = ${venue} AND kind = 'tips' AND status = 'approved'`;
  }
  return {
    submitted,
    held,
    skipped: apiKey && profileId ? null : "credentials-unavailable",
  };
}

/**
 * D5.5 / D5.8 — one venue's weekly cadence: close every collection week that has
 * ended, turn due allocations into payouts, release anything that was held, and
 * push the pending payouts to the provider. Safe to run repeatedly.
 */
export async function runTipCadence(
  env: unknown,
  venue: string,
  actor = "cadence",
): Promise<{
  venue: string;
  closedWeeks: string[];
  payoutsCreated: number;
  payoutsHeld: number;
  payoutsReleased: number;
  submitted: number;
}> {
  const sql = getSql(env);
  if (!sql) {
    return {
      venue,
      closedWeeks: [],
      payoutsCreated: 0,
      payoutsHeld: 0,
      payoutsReleased: 0,
      submitted: 0,
    };
  }
  const now = new Date();
  const settings = await loadTipSettings(sql, venue);
  const closedWeeks = await closeDueWeeks(sql, venue, now, settings);
  const { created, released } = await issueDueTipPayouts(sql, venue, now, actor);
  const submission = await submitTipPayouts(env, venue);
  return {
    venue,
    closedWeeks,
    payoutsCreated: created.length,
    payoutsHeld: created.filter((payout) => payout.status === "held").length,
    payoutsReleased: released,
    submitted: submission.submitted,
  };
}

export async function reconcileTipPayouts(
  env: unknown,
): Promise<{ confirmed: number; failed: number }> {
  const sql = getSql(env);
  const apiKey = envVar(env, "PESASWAP_API_KEY");
  const baseUrl = envVar(env, "PESASWAP_URL") || "https://api.pesaswap.io";
  if (!sql || !apiKey) return { confirmed: 0, failed: 0 };
  const payouts = await sql`
    SELECT id, venue_id, amount, provider_ref FROM tip_payouts
    WHERE status IN ('processing','unknown') AND provider_ref IS NOT NULL
    ORDER BY created_at LIMIT 50`;
  let confirmed = 0;
  let failed = 0;
  for (const payout of payouts) {
    try {
      const response = await fetch(
        `${baseUrl}/payouts/${encodeURIComponent(String(payout.provider_ref))}?force_sync=true`,
        { headers: { "api-key": apiKey, Accept: "application/json" } },
      );
      if (!response.ok) continue;
      const provider = (await response.json()) as Record<string, unknown>;
      const status = String(provider.status ?? "");
      const amount = Number(provider.amount);
      if (amount !== Number(payout.amount) || String(provider.currency) !== "KES") continue;
      if (status === "success") {
        await sql.begin(async (tx) => {
          const eventId = `payout-pull:${provider.payout_id ?? payout.provider_ref}:success`;
          const [evidence] = await tx`
            INSERT INTO tip_payout_evidence
              (payout_id, provider_event_id, provider_ref, amount, currency, evidence)
            VALUES (${payout.id}, ${eventId}, ${payout.provider_ref}, ${amount}, 'KES',
                    ${tx.json(JSON.parse(JSON.stringify(provider)))})
            ON CONFLICT (provider_event_id) DO NOTHING RETURNING id`;
          if (!evidence) return;
          await postEntryInTransaction(tx, {
            venue: String(payout.venue_id),
            sourceType: "tip_payout",
            sourceId: String(payout.id),
            currency: "KES",
            memo: `Tip payout ${payout.provider_ref}`,
            lines: tipPayoutLines(amount),
          });
          await tx`
            UPDATE tip_payouts SET status='confirmed', confirmed_at=now()
            WHERE id=${payout.id}`;
        });
        confirmed += 1;
      } else if (["failed","cancelled","expired","reversed","ineligible"].includes(status)) {
        await sql`UPDATE tip_payouts SET status='failed' WHERE id=${payout.id}`;
        failed += 1;
      }
    } catch {
      /* retry next scheduled sweep */
    }
  }
  return { confirmed, failed };
}
