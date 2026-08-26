// C5.6 / C5.11 / B2.9 — the two stages of getting a payment onto the POS check.
//
// Stage 1 (`recordTenderIntent`) runs inside the payment's own transaction as a
// financial-outbox consumer. It is database-only: it decides whether the POS
// should be told and writes the intent. It must never make a network call — the
// consumer holds a row lock, and an HTTP round trip to a POS inside that lock is
// a self-inflicted outage.
//
// Stage 2 (`runTenderPushWorker`) claims due intents under a lease, calls the
// POS outside any transaction, and records the outcome. Terminal failure sets
// Sunday's `Not Notified` and raises the B2.9 alert to the servers who follow
// that table. This is the same shape `outbound-jobs.ts` uses for messaging.

import type { QuerySql, Sql } from "@/lib/db";
import { connectorFor } from "@/lib/pos/registry";
import { contextFor, getConnection } from "@/lib/pos-checks";
import {
  MAX_PUSH_ATTEMPTS,
  nextAttempt,
  planPush,
} from "@/lib/pos/tender";
import type { PosFailure } from "@/lib/pos/types";
import { deliverStaffNotification } from "@/lib/staff-notify";

const LEASE_SECONDS = 120;

export type TenderIntentInput = {
  venue: string;
  paymentId: string;
  grossMinor: number;
  tipMinor: number;
  guestFeeMinor: number;
  orderId: string | null;
};

/**
 * Stage 1. Returns the detail recorded on the outbox effect, so a replay can see
 * what was decided and why.
 */
export async function recordTenderIntent(
  sql: QuerySql,
  input: TenderIntentInput,
): Promise<Record<string, unknown>> {
  const [connection] = await sql`
    SELECT id, provider FROM pos_connections
    WHERE venue_id = ${input.venue} AND status = 'connected'
    LIMIT 1`;

  // The bill is whichever POS check this order came from. An order with no POS
  // check (a counter sale, a pay link) legitimately has nothing to push.
  const [check] = input.orderId
    ? await sql`
        SELECT c.id, c.pos_bill_id
        FROM orders o
        JOIN pos_checks c ON c.id = o.pos_check_id AND c.venue_id = o.venue_id
        WHERE o.id = ${input.orderId} AND o.venue_id = ${input.venue}
        LIMIT 1`
    : [];

  const plan = planPush({
    hasConnection: Boolean(connection),
    // The worker re-checks this against the live connector; here we only need to
    // know a connection exists, because provider capability is not a DB fact.
    connectorCanPush: Boolean(connection),
    posBillId: check ? String(check.pos_bill_id) : null,
    grossMinor: input.grossMinor,
    tipMinor: input.tipMinor,
    guestFeeMinor: input.guestFeeMinor,
  });

  if (!plan.push) {
    await sql`
      INSERT INTO pos_tender_pushes
        (venue_id, payment_id, order_id, amount_minor, tip_minor, status, last_error)
      VALUES (${input.venue}, ${input.paymentId}, ${input.orderId}, 0, 0, 'skipped',
              ${plan.reason})
      ON CONFLICT (venue_id, payment_id) DO NOTHING`;
    return { pos: "skipped", reason: plan.reason };
  }

  await sql`
    INSERT INTO pos_tender_pushes
      (venue_id, payment_id, check_id, pos_bill_id, order_id, amount_minor,
       tip_minor, status)
    VALUES (${input.venue}, ${input.paymentId}, ${String(check.id)},
            ${plan.posBillId}, ${input.orderId}, ${plan.amountMinor},
            ${plan.tipMinor}, 'pending')
    ON CONFLICT (venue_id, payment_id) DO NOTHING`;
  return { pos: "queued", posBillId: plan.posBillId, amountMinor: plan.amountMinor };
}

type DueRow = {
  id: string;
  venue_id: string;
  payment_id: string;
  check_id: string | null;
  pos_bill_id: string;
  order_id: string | null;
  amount_minor: string | number;
  tip_minor: string | number;
  attempts: number;
  claim_token: string;
};

async function claimDue(sql: Sql, limit: number): Promise<DueRow[]> {
  return (await sql`
    WITH due AS (
      SELECT id FROM pos_tender_pushes
      WHERE status = 'pending'
        AND next_attempt_at <= now()
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE pos_tender_pushes p
    SET claim_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        updated_at = now()
    FROM due
    WHERE p.id = due.id
    RETURNING p.id, p.venue_id, p.payment_id, p.check_id, p.pos_bill_id,
              p.order_id, p.amount_minor, p.tip_minor, p.attempts,
              p.claim_token`) as unknown as DueRow[];
}

/**
 * Raise B2.9 once, on the transition into `not_notified`. `alerted_at` is the
 * guard: a re-run of the worker must not page the floor again for a payment the
 * server has already been told about.
 */
async function alertUnsynced(
  sql: Sql,
  env: unknown,
  row: DueRow,
): Promise<void> {
  const [claimed] = await sql`
    UPDATE pos_tender_pushes SET alerted_at = now()
    WHERE id = ${row.id} AND alerted_at IS NULL
    RETURNING id`;
  if (!claimed) return;

  const [table] = row.check_id
    ? await sql`
        SELECT t.id, t.label
        FROM pos_checks c
        LEFT JOIN dining_tables t ON t.id = c.table_id
        WHERE c.id = ${row.check_id} AND c.venue_id = ${row.venue_id}
        LIMIT 1`
    : [];

  await deliverStaffNotification(env, {
    venue: row.venue_id,
    type: "payment.unsynced",
    table: table?.id ? String(table.id) : null,
    tableLabel: table?.label ? String(table.label) : null,
    amountMinor: Number(row.amount_minor) || 0,
    dedupeKey: `unsynced:${row.payment_id}`,
    data: { paymentId: row.payment_id, posBillId: row.pos_bill_id },
  });
}

async function settle(
  sql: Sql,
  env: unknown,
  row: DueRow,
  outcome: { ok: true; posPaymentId: string | null } | { ok: false; error: PosFailure; detail?: string },
): Promise<"notified" | "not_notified" | "pending"> {
  const decision = nextAttempt(
    outcome.ok ? { ok: true } : { ok: false, error: outcome.error },
    Number(row.attempts) || 0,
  );
  const detail = outcome.ok ? null : (outcome.detail ?? outcome.error);
  const code = outcome.ok ? null : outcome.error;

  const [updated] = await sql`
    UPDATE pos_tender_pushes SET
      status           = ${decision.status},
      attempts         = attempts + 1,
      pos_payment_id   = ${outcome.ok ? outcome.posPaymentId : null},
      notified_at      = ${decision.status === "notified" ? sql`now()` : sql`notified_at`},
      next_attempt_at  = ${
        decision.retryInSeconds === null
          ? sql`next_attempt_at`
          : sql`now() + make_interval(secs => ${decision.retryInSeconds})`
      },
      lease_expires_at = NULL,
      claim_token      = NULL,
      last_error       = ${detail ? String(detail).slice(0, 500) : null},
      last_error_code  = ${code},
      updated_at       = now()
    WHERE id = ${row.id} AND claim_token = ${row.claim_token}::uuid
    RETURNING id`;
  if (!updated) return "pending";
  if (decision.alert) await alertUnsynced(sql, env, row);
  return decision.status === "notified"
    ? "notified"
    : decision.status === "not_notified"
      ? "not_notified"
      : "pending";
}

export type TenderWorkerResult = {
  claimed: number;
  notified: number;
  unsynced: number;
  retrying: number;
};

/** Stage 2. Safe to call as often as the cron fires; the lease prevents overlap. */
export async function runTenderPushWorker(
  sql: Sql,
  env: unknown,
  limit = 50,
): Promise<TenderWorkerResult> {
  const rows = await claimDue(sql, limit);
  const result: TenderWorkerResult = {
    claimed: rows.length,
    notified: 0,
    unsynced: 0,
    retrying: 0,
  };
  if (rows.length === 0) return result;

  // A batch is usually a handful of venues at most, so resolve each venue's
  // connection and mapped tender ONCE rather than once per payment.
  const venues = [...new Set(rows.map((row) => row.venue_id))];
  const connections = new Map<string, Awaited<ReturnType<typeof getConnection>>>();
  for (const venue of venues) {
    connections.set(venue, await getConnection(sql, venue));
  }
  const tenderRows = await sql`
    SELECT venue_id, pos_payment_method_id FROM pos_tender_map
    WHERE venue_id = ANY(${venues}) AND role = 'sunday'`;
  const sundayTender = new Map(
    tenderRows.map((row) => [
      String(row.venue_id),
      String(row.pos_payment_method_id),
    ]),
  );

  for (const row of rows) {
    const connection = connections.get(row.venue_id) ?? null;
    const connector = connection
      ? connectorFor(connection.provider, env)
      : null;
    const ctx = connection ? contextFor(connection, env) : null;

    if (!connection || connection.status !== "connected") {
      await settle(sql, env, row, { ok: false, error: "misconfigured", detail: "no live POS connection" });
      result.unsynced += 1;
      continue;
    }
    if (!connector?.pushTender || !connector.capabilities.has("tender.push")) {
      await settle(sql, env, row, { ok: false, error: "unsupported" });
      result.unsynced += 1;
      continue;
    }
    if (!ctx) {
      const outcome = await settle(sql, env, row, { ok: false, error: "not_configured" });
      if (outcome === "not_notified") result.unsynced += 1;
      else result.retrying += 1;
      continue;
    }

    const tender = sundayTender.get(row.venue_id);
    if (!tender) {
      // Without a mapped `sunday` tender the payment would land under whatever
      // the POS defaults to, which is Sunday's discrepancy class 2. Refuse.
      await settle(sql, env, row, {
        ok: false,
        error: "misconfigured",
        detail: "no POS payment method mapped to the sunday tender",
      });
      result.unsynced += 1;
      continue;
    }

    const push = await connector.pushTender(ctx, {
      posBillId: row.pos_bill_id,
      posPaymentMethodId: tender,
      amountMinor: Number(row.amount_minor) || 0,
      tipMinor: Number(row.tip_minor) || 0,
      currency: "KES",
      // The payment id, so a retry whose first response we lost resolves to the
      // same POS payment instead of tendering the check twice.
      idempotencyKey: row.payment_id,
    });

    const outcome = await settle(
      sql,
      env,
      row,
      push.ok
        ? { ok: true, posPaymentId: push.data.posPaymentId }
        : { ok: false, error: push.error, detail: push.detail },
    );
    if (outcome === "notified") result.notified += 1;
    else if (outcome === "not_notified") result.unsynced += 1;
    else result.retrying += 1;
  }

  return result;
}

export { MAX_PUSH_ATTEMPTS };
