import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import {
  judgeMoney,
  judgeQueue,
  overallSeverity,
  type MoneySample,
  type QueueSample,
} from "@/lib/ops-health";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Every table that holds work waiting to be done.
 *
 * `pending` is what is due now — an item scheduled for the future is not late.
 * `failed` counts what has exhausted its retries, which is the only category
 * that never recovers without a human.
 */
const QUEUES: readonly {
  name: string;
  table: string;
  pending: string;
  failed?: string;
  lease?: boolean;
}[] = [
  {
    name: "financial_outbox",
    table: "financial_outbox",
    pending: "status IN ('pending','failed') AND next_attempt_at <= now()",
    failed: "attempts >= 10",
    lease: true,
  },
  {
    name: "outbound_deliveries",
    table: "outbound_deliveries",
    pending:
      "status IN ('queued','failed','deferred') AND retryable AND next_attempt_at <= now()",
    failed: "NOT retryable AND status = 'failed'",
    lease: true,
  },
  {
    name: "pos_tender_pushes",
    table: "pos_tender_pushes",
    pending: "status IN ('pending','failed') AND next_attempt_at <= now()",
    failed: "attempts >= 5 AND status <> 'succeeded'",
    lease: true,
  },
  {
    name: "channel_ingress_events",
    table: "channel_ingress_events",
    pending: "status IN ('pending','failed') AND next_attempt_at <= now()",
    failed: "attempts >= 10",
    lease: true,
  },
  {
    name: "invoice_communication_outbox",
    table: "invoice_communication_outbox",
    pending: "status IN ('pending','failed') AND next_attempt_at <= now()",
    failed: "attempts >= 10",
    lease: true,
  },
];

/** Money that has stopped moving, and how long that is tolerable for each kind. */
const MONEY: readonly {
  name: string;
  sql: string;
  toleranceHours: number;
}[] = [
  {
    name: "payout_runs_awaiting_approval",
    sql: `SELECT count(*)::int AS count, COALESCE(sum(total_amount),0)::bigint AS amount,
                 EXTRACT(EPOCH FROM (now() - min(created_at)))::float8 AS oldest
          FROM staff_payout_runs WHERE status = 'pending_approval'`,
    // A run created on Friday and approved on Monday is normal. A week is not.
    toleranceHours: 48,
  },
  {
    name: "tip_payouts_held",
    sql: `SELECT count(*)::int AS count, COALESCE(sum(amount),0)::bigint AS amount,
                 EXTRACT(EPOCH FROM (now() - min(created_at)))::float8 AS oldest
          FROM tip_payouts WHERE status = 'held'`,
    toleranceHours: 72,
  },
  {
    name: "salary_payouts_held",
    sql: `SELECT count(*)::int AS count, COALESCE(sum(amount),0)::bigint AS amount,
                 EXTRACT(EPOCH FROM (now() - min(created_at)))::float8 AS oldest
          FROM salary_payouts WHERE status = 'held'`,
    toleranceHours: 72,
  },
  {
    name: "payments_in_flight",
    sql: `SELECT count(*)::int AS count, COALESCE(sum(amount),0)::bigint AS amount,
                 EXTRACT(EPOCH FROM (now() - min(created_at)))::float8 AS oldest
          FROM payments WHERE status IN ('processing','requires_capture')`,
    // An M-Pesa STK either resolves in minutes or is never going to.
    toleranceHours: 1,
  },
];

export async function handleOpsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/ops/")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  // Queue depth is deployment-wide. Only a platform admin may see across tenants.
  if (payload.role !== "admin") return json({ error: "forbidden" }, 403);

  if (url.pathname !== "/api/ops/health" || request.method !== "GET") {
    return json({ error: "not found" }, 404);
  }

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const queues: QueueSample[] = [];
  for (const queue of QUEUES) {
    try {
      // Age is measured from `next_attempt_at`, not `created_at`: it answers "how
      // overdue is the oldest due item", so a deliberate retry backoff is not
      // counted as lateness. `financial_outbox` has no `created_at` at all.
      const [row] = await sql.unsafe(`
        SELECT
          count(*) FILTER (WHERE ${queue.pending})::int AS depth,
          EXTRACT(EPOCH FROM (now() - min(next_attempt_at) FILTER (WHERE ${queue.pending})))::float8 AS oldest,
          ${queue.failed ? `count(*) FILTER (WHERE ${queue.failed})::int` : "0"} AS failed,
          ${queue.lease ? "count(*) FILTER (WHERE lease_expires_at < now() AND status = 'processing')::int" : "0"} AS stalled
        FROM ${queue.table}`);
      queues.push({
        name: queue.name,
        depth: Number(row?.depth ?? 0),
        oldestSeconds: row?.oldest === null ? null : Number(row?.oldest ?? 0),
        failed: Number(row?.failed ?? 0),
        stalled: Number(row?.stalled ?? 0),
        error: null,
      });
    } catch (error) {
      // Reported as an error, never as zeros: a missing table or a renamed column
      // would otherwise render as a perfectly healthy empty queue.
      queues.push({
        name: queue.name,
        depth: 0,
        oldestSeconds: null,
        failed: 0,
        stalled: 0,
        error: error instanceof Error ? error.message.split("\n")[0] : "unknown",
      });
    }
  }

  const money: MoneySample[] = [];
  for (const item of MONEY) {
    try {
      const [row] = await sql.unsafe(item.sql);
      money.push({
        name: item.name,
        count: Number(row?.count ?? 0),
        amountMinor: Number(row?.amount ?? 0),
        oldestSeconds: row?.oldest === null ? null : Number(row?.oldest ?? 0),
        toleranceHours: item.toleranceHours,
        error: null,
      });
    } catch (error) {
      money.push({
        name: item.name,
        count: 0,
        amountMinor: 0,
        oldestSeconds: null,
        toleranceHours: item.toleranceHours,
        error: error instanceof Error ? error.message.split("\n")[0] : "unknown",
      });
    }
  }

  const queueVerdicts = queues.map(judgeQueue);
  const moneyVerdicts = money.map(judgeMoney);

  // Monitoring that is switched off is itself a finding — without this, a
  // deployment with no error reporting looks identical to a healthy one.
  const errorReporting = Boolean(envVar(env, "SENTRY_DSN"));
  const config = [
    { name: "sentry", configured: errorReporting },
    { name: "pesaswap_payouts", configured: Boolean(envVar(env, "PESASWAP_API_KEY")) },
    { name: "staff_payout_key", configured: Boolean(envVar(env, "STAFF_PAYOUT_KEY")) },
    { name: "rate_limiter_do", configured: Boolean((env as { RATE_LIMITER?: unknown })?.RATE_LIMITER) },
  ];

  return json({
    status: overallSeverity([
      ...queueVerdicts,
      ...moneyVerdicts,
      // An unconfigured error reporter does not degrade service, so it warns
      // rather than pages.
      { severity: errorReporting ? ("ok" as const) : ("warn" as const) },
    ]),
    checkedAt: new Date().toISOString(),
    queues: queueVerdicts,
    money: moneyVerdicts,
    config,
  });
}
