import type { QuerySql, Sql, TransactionSql } from "@/lib/db";

export type FinancialEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "refund.succeeded";

export type FinancialEventPayload = {
  paymentId: string;
  venue: string;
  amount: number;
  currency: string;
  status: string;
  kind: string;
  providerRef?: string | null;
  reference?: string | null;
  metadata: Record<string, unknown>;
};

export const PAYMENT_CONSUMERS = [
  "accounting",
  "invoice",
  "commission",
  "subscription",
  "loyalty",
  "saved-method",
  "order",
  "pay-link",
  "pos-tender",
] as const;

export const REFUND_CONSUMERS = [
  "accounting-reversal",
  "commission-reversal",
  "loyalty-reversal",
  "tip-reversal",
  "cogs-reversal",
  "order-reversal",
  "pay-link-reversal",
  "invoice-reversal",
  "settlement-reversal",
] as const;

export async function enqueueFinancialEvent(
  sql: QuerySql,
  input: {
    eventKey: string;
    venue: string;
    aggregateId: string;
    eventType: FinancialEventType;
    eventSequence?: number;
    payload: FinancialEventPayload;
    consumers: readonly string[];
  },
): Promise<string | null> {
  const [event] = await sql`
    INSERT INTO financial_events
      (event_key, venue_id, aggregate_type, aggregate_id, event_type,
       event_sequence, payload)
    VALUES
      (${input.eventKey}, ${input.venue}, 'payment', ${input.aggregateId},
       ${input.eventType}, ${input.eventSequence ?? 0},
       ${sql.json(JSON.parse(JSON.stringify(input.payload)))})
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id`;
  if (!event) return null;
  for (const consumer of input.consumers) {
    await sql`
      INSERT INTO financial_outbox (event_id, consumer)
      VALUES (${event.id}, ${consumer})
      ON CONFLICT (event_id, consumer) DO NOTHING`;
  }
  return String(event.id);
}

export async function claimFinancialOutbox(
  sql: Sql,
  limit = 25,
): Promise<Array<Record<string, unknown>>> {
  const claimToken = crypto.randomUUID();
  return sql`
    WITH candidates AS (
      SELECT o.id
      FROM financial_outbox o
      JOIN financial_events e ON e.id = o.event_id
      WHERE (
          (o.status IN ('pending', 'failed') AND o.next_attempt_at <= now())
          OR
          (o.status = 'processing' AND o.lease_expires_at < now())
        )
        AND NOT EXISTS (
          SELECT 1 FROM financial_events prior
          WHERE prior.aggregate_type = e.aggregate_type
            AND prior.aggregate_id = e.aggregate_id
            AND prior.processed_at IS NULL
            AND (prior.event_sequence, prior.occurred_at, prior.id)
              < (e.event_sequence, e.occurred_at, e.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM financial_events active
          JOIN financial_outbox active_outbox ON active_outbox.event_id = active.id
          WHERE active.aggregate_type = e.aggregate_type
            AND active.aggregate_id = e.aggregate_id
            AND active.id <> e.id
            AND active_outbox.status = 'processing'
            AND active_outbox.lease_expires_at >= now()
        )
      ORDER BY o.next_attempt_at, e.occurred_at
      LIMIT ${Math.max(1, Math.min(100, limit))}
      FOR UPDATE OF o SKIP LOCKED
    ), claimed AS (
      UPDATE financial_outbox o
      SET status = 'processing', claimed_at = now(),
          lease_expires_at = now() + interval '2 minutes',
          claim_token = ${claimToken}, attempts = attempts + 1
      FROM candidates c
      WHERE o.id = c.id
      RETURNING o.id, o.event_id, o.consumer, o.attempts,
                o.claim_token, o.lease_expires_at
    )
    SELECT c.*, e.event_type, e.venue_id, e.aggregate_id, e.payload
    FROM claimed c
    JOIN financial_events e ON e.id = c.event_id` as unknown as Array<
    Record<string, unknown>
  >;
}

export async function beginFinancialEffect(
  sql: TransactionSql,
  row: Record<string, unknown>,
): Promise<boolean> {
  const eventId = String(row.event_id);
  const outboxId = String(row.id);
  const consumer = String(row.consumer);
  const claimToken = String(row.claim_token);
  const [owned] = await sql`
    SELECT 1 FROM financial_outbox
    WHERE id = ${outboxId} AND status = 'processing'
      AND claim_token = ${claimToken}::uuid
    FOR UPDATE`;
  if (!owned) return false;
  const [inserted] = await sql`
    INSERT INTO financial_effects (event_id, consumer, detail)
    VALUES (${eventId}, ${consumer}, '{}'::jsonb)
    ON CONFLICT (event_id, consumer) DO NOTHING
    RETURNING event_id`;
  if (inserted) return true;
  await completeFinancialEffect(sql, row, { replay: true });
  return false;
}

export async function completeFinancialEffect(
  sql: QuerySql,
  row: Record<string, unknown>,
  detail: Record<string, unknown> = {},
): Promise<boolean> {
  const eventId = String(row.event_id);
  const outboxId = String(row.id);
  const consumer = String(row.consumer);
  const claimToken = String(row.claim_token);
  const [completed] = await sql`
    UPDATE financial_outbox
    SET status = 'completed', completed_at = now(), last_error = NULL,
        lease_expires_at = NULL
    WHERE id = ${outboxId} AND status = 'processing'
      AND claim_token = ${claimToken}::uuid
    RETURNING id`;
  if (!completed) return false;
  await sql`
    UPDATE financial_effects
    SET detail = ${sql.json(JSON.parse(JSON.stringify(detail)))}
    WHERE event_id = ${eventId} AND consumer = ${consumer}`;
  const [remaining] = await sql`
    SELECT 1 FROM financial_outbox
    WHERE event_id = ${eventId} AND status <> 'completed' LIMIT 1`;
  if (!remaining) {
    await sql`
      UPDATE financial_events SET processed_at = now(), last_error = NULL
      WHERE id = ${eventId}`;
  }
  return true;
}

export async function failFinancialEffect(
  sql: Sql,
  row: Record<string, unknown>,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const attempts = Number(row.attempts ?? 0) + 1;
  const eventId = String(row.event_id);
  const outboxId = String(row.id);
  const claimToken = String(row.claim_token);
  const delaySeconds = Math.min(3600, Math.max(5, 2 ** Math.min(attempts, 10)));
  const [failed] = await sql`
    UPDATE financial_outbox
    SET status = 'failed', last_error = ${message.slice(0, 1000)},
        next_attempt_at = now() + make_interval(secs => ${delaySeconds})
    WHERE id = ${outboxId} AND status = 'processing'
      AND claim_token = ${claimToken}::uuid
    RETURNING id`;
  if (!failed) return;
  await sql`
    UPDATE financial_events
    SET attempts = attempts + 1, last_error = ${message.slice(0, 1000)},
        next_attempt_at = now() + make_interval(secs => ${delaySeconds})
    WHERE id = ${eventId}`;
}
