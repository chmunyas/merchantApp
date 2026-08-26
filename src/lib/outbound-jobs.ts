import { getAdapter } from "@/lib/channels";
import type { ChannelId, OutboundResult } from "@/lib/channels/types";
import { getSql } from "@/lib/db";
import {
  authorizeOutbound,
  type MessagePurpose,
} from "@/lib/outbound-policy";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type QueueOutboundInput = {
  deliveryKey: string;
  runId?: string | null;
  venue: string;
  sourceType: string;
  sourceId?: string | null;
  channel: ChannelId;
  handle: string;
  recipientName?: string | null;
  purpose: MessagePurpose;
  templateId?: string | null;
  body: string;
  nextAttemptAt?: Date;
};

export async function queueOutbound(
  env: unknown,
  input: QueueOutboundInput,
): Promise<{ id: string | null; queued: boolean }> {
  const sql = getSql(env);
  if (!sql) throw new Error("database not configured");
  const rows = await sql`
    INSERT INTO outbound_deliveries
      (delivery_key, run_id, venue_id, source_type, source_id, channel,
       handle, recipient_name, purpose, template_id, body, next_attempt_at)
    VALUES (${input.deliveryKey}, ${input.runId ?? null}, ${input.venue},
            ${input.sourceType}, ${input.sourceId ?? null}, ${input.channel},
            ${input.handle}, ${input.recipientName ?? null}, ${input.purpose},
            ${input.templateId ?? null}, ${input.body},
            ${input.nextAttemptAt ?? new Date()})
    ON CONFLICT (delivery_key) DO NOTHING
    RETURNING id`;
  return { id: rows[0]?.id ? String(rows[0].id) : null, queued: rows.length > 0 };
}

export async function hasVerifiedChannelAccount(
  env: unknown,
  venue: string,
  channel: ChannelId,
): Promise<boolean> {
  if (channel === "web") return true;
  const sql = getSql(env);
  if (!sql) return false;
  const [row] = await sql`
    SELECT 1 FROM channel_accounts
    WHERE venue_id = ${venue} AND channel = ${channel}
      AND active AND verified_at IS NOT NULL LIMIT 1`;
  return Boolean(row);
}

async function claim(sql: Sql, limit: number) {
  const token = crypto.randomUUID();
  return await sql`
    WITH due AS (
      SELECT id FROM outbound_deliveries
      WHERE ((status IN ('queued','failed','deferred') AND next_attempt_at <= now())
          OR (status = 'processing' AND lease_expires_at < now() AND submitted_at IS NULL))
        AND retryable
      ORDER BY next_attempt_at, created_at
      FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    UPDATE outbound_deliveries d
    SET status = 'processing', claim_token = ${token},
        lease_expires_at = now() + interval '2 minutes', attempts = attempts + 1
    FROM due WHERE d.id = due.id
    RETURNING d.*`;
}

function decorateBody(channel: string, purpose: MessagePurpose, body: string): string {
  if (channel === "sms") return `${body}\nReply STOP to opt out; HELP for help.`;
  if (channel === "email" && purpose === "marketing") {
    return `${body}\n\nTo unsubscribe, reply with UNSUBSCRIBE.`;
  }
  return body;
}

async function complete(
  sql: Sql,
  row: Record<string, unknown>,
  result: OutboundResult,
): Promise<void> {
  const attempt = Number(row.attempts);
  const deliveryId = String(row.id);
  const claimToken = String(row.claim_token);
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO delivery_attempts
        (delivery_id, attempt_no, state, provider_message_id, provider_code,
         error, retryable, response)
      VALUES (${deliveryId}, ${attempt}, ${result.delivery},
              ${result.providerMessageId ?? null}, ${result.providerCode ?? null},
              ${result.error ?? null}, ${result.retryable ?? false},
              ${tx.json(result)})`;
    const retryAt = new Date(
      Date.now() + (result.retryAfterSeconds ?? Math.min(3600, 2 ** attempt)) * 1000,
    );
    const updated = await tx`
      UPDATE outbound_deliveries
      SET status = ${result.delivery}, provider_message_id = ${result.providerMessageId ?? null},
          provider_code = ${result.providerCode ?? null}, last_error = ${result.error ?? null},
          retryable = ${result.delivery === "unknown" ? false : (result.retryable ?? false)},
          accepted_at = CASE WHEN ${result.delivery} = 'accepted' THEN now() ELSE accepted_at END,
          failed_at = CASE WHEN ${result.delivery} = 'failed' THEN now() ELSE failed_at END,
          next_attempt_at = ${retryAt}, claim_token = NULL, lease_expires_at = NULL
      WHERE id = ${deliveryId} AND claim_token = ${claimToken}
      RETURNING id`;
    if (updated.length === 0) throw new Error("stale delivery claim");
    if (
      result.delivery === "accepted" &&
      String(row.purpose) !== "authentication" &&
      ["broadcast", "sequence", "share", "invoice_communication", "order_update", "agent_payment_link"].includes(String(row.source_type))
    ) {
      const storedHandle = String(row.handle).startsWith(`${String(row.channel)}:`)
        ? String(row.handle)
        : `${String(row.channel)}:${String(row.handle)}`;
      const [conversation] = await tx`
        INSERT INTO conversations (venue_id, wa_id, name, role, channel)
        VALUES (${String(row.venue_id)}, ${storedHandle},
                ${row.recipient_name == null ? null : String(row.recipient_name)},
                'customer', ${String(row.channel)})
        ON CONFLICT (venue_id, channel, wa_id) DO UPDATE
          SET last_message_at = now(), name = COALESCE(conversations.name, EXCLUDED.name)
        RETURNING id`;
      await tx`
        INSERT INTO messages (conversation_id, direction, body, ai, tool, channel)
        VALUES (${conversation.id}, 'outbound', ${String(row.body)}, false,
                ${String(row.source_type)}, ${String(row.channel)})`;
    }
    await tx`
      INSERT INTO events
        (venue_id, channel, direction, type, status, payload)
      VALUES (${String(row.venue_id)}, ${String(row.channel)}, 'outbound',
              ${String(row.source_type)}, ${result.delivery},
              ${tx.json({ delivery_id: deliveryId, provider_message_id: result.providerMessageId ?? null })})`;
  });
}

export async function runOutboundWorker(
  env: unknown,
  limit = 100,
): Promise<{ claimed: number; accepted: number; failed: number; blocked: number }> {
  const sql = getSql(env);
  if (!sql) return { claimed: 0, accepted: 0, failed: 0, blocked: 0 };
  await replayReceipts(env);
  await sql`
    UPDATE outbound_deliveries
    SET status = 'unknown', retryable = false, claim_token = NULL,
        lease_expires_at = NULL,
        last_error = COALESCE(last_error, 'provider call submitted; terminal outcome not recorded')
    WHERE status = 'processing' AND lease_expires_at < now()
      AND submitted_at IS NOT NULL`;
  const rows = await claim(sql, limit);
  let accepted = 0;
  let failed = 0;
  let blocked = 0;
  for (const row of rows) {
    const account = String(row.channel) === "web"
      ? { account_id: "web" }
      : (await sql`
          SELECT account_id FROM channel_accounts
          WHERE venue_id = ${row.venue_id} AND channel = ${row.channel}
            AND active AND verified_at IS NOT NULL
          ORDER BY verified_at DESC LIMIT 1`)[0];
    if (!account) {
      await complete(sql, row, {
        delivery: "failed",
        retryable: false,
        error: "no verified venue channel account",
      });
      failed += 1;
      continue;
    }
    await sql`
      UPDATE outbound_deliveries SET account_id = ${String(account.account_id)}
      WHERE id = ${row.id} AND claim_token = ${row.claim_token}`;
    const [template] = row.template_id
      ? await sql`
          SELECT provider_template_id, locale FROM channel_templates
          WHERE id = ${row.template_id} AND venue_id = ${row.venue_id}
            AND channel = ${row.channel} AND approved`
      : [];
    const policy = await authorizeOutbound(env, {
      venue: String(row.venue_id),
      channel: String(row.channel) as ChannelId,
      handle: String(row.handle),
      purpose: String(row.purpose) as MessagePurpose,
      templateId: row.template_id ? String(row.template_id) : null,
      accountId: String(account.account_id),
      replyToInbound: row.source_type === "agent_reply" || row.source_type === "keyword_reply",
      allowSuppressionConfirmation: row.source_type === "keyword_reply",
    });
    if (!policy.allowed) {
      const status = policy.status === "deferred" ? "deferred" : policy.status === "suppressed" ? "suppressed" : "failed";
      const retryAt = policy.retryAt ? new Date(policy.retryAt) : new Date();
      await sql`
        UPDATE outbound_deliveries
        SET status = ${status}, policy_snapshot = ${sql.json(JSON.parse(JSON.stringify(policy.snapshot)))},
            last_error = ${policy.reason ?? null}, retryable = ${policy.status === "deferred"},
            next_attempt_at = ${retryAt}, claim_token = NULL, lease_expires_at = NULL
        WHERE id = ${row.id} AND claim_token = ${row.claim_token}`;
      blocked += 1;
      continue;
    }
    const wireBody = decorateBody(
      String(row.channel),
      String(row.purpose) as MessagePurpose,
      String(row.body),
    );
    const prepared = await sql`
      UPDATE outbound_deliveries
      SET policy_snapshot = ${sql.json(JSON.parse(JSON.stringify(policy.snapshot)))},
          body = ${wireBody}, submitted_at = now()
      WHERE id = ${row.id} AND claim_token = ${row.claim_token}
        AND status = 'processing'
      RETURNING id`;
    if (prepared.length === 0) continue;
    await sql`
      INSERT INTO delivery_attempts
        (delivery_id, attempt_no, state, retryable, response)
      VALUES (${String(row.id)}, ${Number(row.attempts)}, 'submitted', false,
              ${sql.json({ delivery_key: row.delivery_key })})`;
    let result: OutboundResult;
    try {
      result = await getAdapter(String(row.channel)).send(
        String(row.handle),
        wireBody,
        env,
        String(row.venue_id),
        template
          ? {
              template: { name: String(template.provider_template_id), locale: String(template.locale) },
              idempotencyKey: String(row.delivery_key),
              accountId: String(account.account_id),
            }
          : {
              idempotencyKey: String(row.delivery_key),
              accountId: String(account.account_id),
            },
      );
    } catch (error) {
      result = {
        delivery: "failed",
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await complete(sql, row, result);
    if (result.delivery === "accepted") accepted += 1;
    else failed += 1;
  }
  await replayReceipts(env);
  return { claimed: rows.length, accepted, failed, blocked };
}

export async function applyDeliveryReceipt(
  env: unknown,
  input: {
    channel: string;
    accountId: string;
    providerMessageId: string;
    status: "delivered" | "read" | "failed";
    providerCode?: string;
  },
): Promise<boolean> {
  const sql = getSql(env);
  if (!sql) throw new Error("database not configured");
  const [receipt] = await sql`
    INSERT INTO channel_delivery_receipts
      (channel, account_id, provider_message_id, status, provider_code)
    VALUES (${input.channel}, ${input.accountId}, ${input.providerMessageId},
            ${input.status}, ${input.providerCode ?? null})
    ON CONFLICT (channel, account_id, provider_message_id, status)
      DO UPDATE SET provider_code = COALESCE(EXCLUDED.provider_code,
                                             channel_delivery_receipts.provider_code)
    RETURNING id`;
  const rank: Record<string, number> = { accepted: 1, delivered: 2, read: 3 };
  return await sql.begin(async (tx) => {
    const [row] = await tx`
      SELECT id, status FROM outbound_deliveries
      WHERE channel = ${input.channel} AND account_id = ${input.accountId}
        AND provider_message_id = ${input.providerMessageId}
      FOR UPDATE`;
    if (!row) return false;
    const current = String(row.status);
    const shouldApply = input.status === "failed"
      ? !["failed", "delivered", "read"].includes(current)
      : rank[input.status] > (rank[current] ?? 0);
    if (!shouldApply) {
      await tx`UPDATE channel_delivery_receipts SET applied_at = now() WHERE id = ${receipt.id}`;
      return false;
    }
    await tx`
      UPDATE outbound_deliveries
      SET status = ${input.status}, provider_code = COALESCE(${input.providerCode ?? null}, provider_code),
          delivered_at = CASE WHEN ${input.status} IN ('delivered','read') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
          read_at = CASE WHEN ${input.status} = 'read' THEN now() ELSE read_at END,
          failed_at = CASE WHEN ${input.status} = 'failed' THEN now() ELSE failed_at END,
          retryable = false
      WHERE id = ${row.id}`;
    await tx`UPDATE channel_delivery_receipts SET applied_at = now() WHERE id = ${receipt.id}`;
    return true;
  });
}

async function replayReceipts(env: unknown, limit = 100): Promise<void> {
  const sql = getSql(env);
  if (!sql) return;
  const rows = await sql`
    SELECT channel, account_id, provider_message_id, status, provider_code
    FROM channel_delivery_receipts
    WHERE applied_at IS NULL ORDER BY created_at LIMIT ${limit}`;
  for (const row of rows) {
    await applyDeliveryReceipt(env, {
      channel: String(row.channel),
      accountId: String(row.account_id),
      providerMessageId: String(row.provider_message_id),
      status: String(row.status) as "delivered" | "read" | "failed",
      providerCode: row.provider_code == null ? undefined : String(row.provider_code),
    });
  }
}
