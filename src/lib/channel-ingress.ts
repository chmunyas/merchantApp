import type { ChannelId, InboundMessage } from "@/lib/channels/types";
import { getSql } from "@/lib/db";
import { processInbound } from "@/lib/inbound";

export type IngressEnvelope = {
  channel: ChannelId;
  accountId: string;
  venue: string;
  providerEventId: string;
  message: InboundMessage;
};

type Sql = NonNullable<ReturnType<typeof getSql>>;

function eventId(envelope: IngressEnvelope): string {
  if (envelope.providerEventId.trim()) return envelope.providerEventId.trim();
  return `generated:${crypto.randomUUID()}`;
}

export async function persistIngress(
  env: unknown,
  envelope: IngressEnvelope,
): Promise<{ id: string | null; deduped: boolean }> {
  const sql = getSql(env);
  if (!sql) throw new Error("database not configured");
  const providerEventId = eventId(envelope);
  const rows = await sql`
    INSERT INTO channel_ingress_events
      (channel, account_id, venue_id, provider_event_id, payload)
    VALUES (${envelope.channel}, ${envelope.accountId}, ${envelope.venue},
            ${providerEventId}, ${sql.json(envelope.message)})
    ON CONFLICT (channel, account_id, provider_event_id) DO NOTHING
    RETURNING id`;
  return { id: rows[0]?.id ? String(rows[0].id) : null, deduped: rows.length === 0 };
}

async function claimIngress(sql: Sql, limit: number) {
  const token = crypto.randomUUID();
  const rows = await sql`
    WITH due AS (
      SELECT id FROM channel_ingress_events
      WHERE (status IN ('pending','failed') AND next_attempt_at <= now())
         OR (status = 'processing' AND lease_expires_at < now())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE channel_ingress_events i
    SET status = 'processing', claim_token = ${token},
        lease_expires_at = now() + interval '2 minutes', attempts = attempts + 1
    FROM due WHERE i.id = due.id
    RETURNING i.id, i.venue_id, i.channel, i.account_id, i.payload,
              i.provider_event_id, i.attempts, i.claim_token, i.created_at`;
  return rows;
}

export async function runIngressWorker(
  env: unknown,
  limit = 50,
): Promise<{ claimed: number; completed: number; failed: number }> {
  const sql = getSql(env);
  if (!sql) return { claimed: 0, completed: 0, failed: 0 };
  const rows = await claimIngress(sql, limit);
  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await processInbound(
        row.payload as InboundMessage,
        String(row.venue_id),
        env,
        String(row.account_id),
        String(row.id),
        new Date(row.created_at),
      );
      if (result.error) throw new Error(result.error);
      const updated = await sql`
        UPDATE channel_ingress_events
        SET status = 'completed', completed_at = now(), claim_token = NULL,
            lease_expires_at = NULL, last_error = NULL
        WHERE id = ${row.id} AND claim_token = ${row.claim_token}
        RETURNING id`;
      if (updated.length === 0) throw new Error("stale ingress claim");
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sql`
        UPDATE channel_ingress_events
        SET status = 'failed', claim_token = NULL, lease_expires_at = NULL,
            next_attempt_at = now() +
              (LEAST(3600, power(2, LEAST(attempts, 10))) || ' seconds')::interval,
            last_error = ${message.slice(0, 1000)}
        WHERE id = ${row.id} AND claim_token = ${row.claim_token}`;
      failed += 1;
    }
  }
  return { claimed: rows.length, completed, failed };
}
