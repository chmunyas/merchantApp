import type { ChannelId } from "@/lib/channels/types";
import { getSql } from "@/lib/db";
import { queueOutbound } from "@/lib/outbound-jobs";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type BroadcastParams = {
  venue: string;
  segment: "all" | "gold_plus" | "lapsed";
  channel: ChannelId;
  message: string;
  idempotencyKey: string;
  createdBy?: string | null;
  templateId?: string | null;
};

export type BroadcastResult = {
  total: number;
  runId?: string;
  queued: number;
  duplicate: number;
  channel: string;
  segment: string;
  error?: string;
};

// Resolve recipients for a segment. Phone channels (WhatsApp/SMS) draw from the
// CRM contacts; chat channels (Telegram/Instagram) draw from the identity graph.
async function resolveRecipients(
  sql: Sql,
  venue: string,
  channel: ChannelId,
  segment: BroadcastParams["segment"],
): Promise<Array<{ handle: string; name: string | null }>> {
  if (channel === "whatsapp" || channel === "sms") {
    let rows;
    if (segment === "gold_plus") {
      rows = await sql`
        SELECT name, phone FROM contacts
        WHERE venue_id = ${venue} AND phone IS NOT NULL
          AND tier IN ('Gold', 'Platinum')`;
    } else if (segment === "lapsed") {
      rows = await sql`
        SELECT name, phone FROM contacts
        WHERE venue_id = ${venue} AND phone IS NOT NULL AND visits <= 1`;
    } else {
      rows = await sql`
        SELECT name, phone FROM contacts
        WHERE venue_id = ${venue} AND phone IS NOT NULL`;
    }
    return rows.map((row) => ({
      handle: String(row.phone).startsWith("+")
        ? String(row.phone)
        : `+${row.phone}`,
      name: row.name ?? null,
    }));
  }
  if (channel === "email") {
    let rows;
    if (segment === "gold_plus") {
      rows = await sql`
        SELECT name, email FROM contacts
        WHERE venue_id = ${venue} AND email IS NOT NULL
          AND tier IN ('Gold', 'Platinum')`;
    } else if (segment === "lapsed") {
      rows = await sql`
        SELECT name, email FROM contacts
        WHERE venue_id = ${venue} AND email IS NOT NULL AND visits <= 1`;
    } else {
      rows = await sql`
        SELECT name, email FROM contacts
        WHERE venue_id = ${venue} AND email IS NOT NULL`;
    }
    return rows.map((row) => ({
      handle: String(row.email).toLowerCase(),
      name: row.name ?? null,
    }));
  }
  const rows = await sql`
    SELECT pi.platform_user_id AS handle, p.display_name AS name
    FROM platform_identities pi
    JOIN persons p ON p.id = pi.person_id
    WHERE pi.venue_id = ${venue} AND pi.channel = ${channel}`;
  return rows.map((row) => ({ handle: row.handle, name: row.name ?? null }));
}

// Materialize one deterministic durable delivery per campaign recipient. A
// leased worker performs policy checks and provider calls after the API returns.
export async function sendBroadcast(
  env: unknown,
  params: BroadcastParams,
): Promise<BroadcastResult> {
  const sql = getSql(env);
  if (!sql) {
    return {
      total: 0,
      queued: 0,
      duplicate: 0,
      channel: params.channel,
      segment: params.segment,
      error: "database not configured",
    };
  }
  const { venue, segment, channel, message } = params;
  const runRows = await sql`
    INSERT INTO campaign_runs
      (venue_id, kind, idempotency_key, channel, segment, purpose, template_id,
       message, created_by)
    VALUES (${venue}, 'broadcast', ${params.idempotencyKey}, ${channel}, ${segment},
            'marketing', ${params.templateId ?? null}, ${message},
            ${params.createdBy ?? null})
    ON CONFLICT (venue_id, idempotency_key) DO NOTHING RETURNING id`;
  let duplicateRun = false;
  let runId: string;
  if (runRows.length === 0) {
    const [existing] = await sql`
      SELECT id, channel, segment, message FROM campaign_runs
      WHERE venue_id = ${venue} AND idempotency_key = ${params.idempotencyKey}`;
    if (!existing?.id) throw new Error("campaign run conflict could not be resolved");
    if (
      String(existing.channel) !== channel ||
      String(existing.segment) !== segment ||
      String(existing.message) !== message
    ) {
      throw new Error("idempotency key reused with different broadcast input");
    }
    runId = String(existing.id);
    duplicateRun = true;
  } else {
    runId = String(runRows[0].id);
  }
  const recipients = await resolveRecipients(sql, venue, channel, segment);
  const [venueRow] = await sql`SELECT name FROM venues WHERE id = ${venue}`;
  const venueName = venueRow?.name ?? venue;

  const personalize = (name: string | null): string =>
    message
      .replace(/\{\{\s*name\s*\}\}/g, name ?? "there")
      .replace(/\{\{\s*venue\s*\}\}/g, venueName);

  let queued = 0;

  for (const recipient of recipients) {
    const text = personalize(recipient.name);
    const result = await queueOutbound(env, {
      deliveryKey: `broadcast:${runId}:${channel}:${recipient.handle}`,
      runId,
      venue,
      sourceType: "broadcast",
      sourceId: runId,
      channel,
      handle: recipient.handle,
      recipientName: recipient.name,
      purpose: "marketing",
      templateId: params.templateId,
      body: text,
    });
    if (result.queued) queued += 1;
  }

  return {
    total: recipients.length,
    runId,
    queued,
    duplicate: recipients.length - queued + (duplicateRun ? 1 : 0),
    channel,
    segment,
  };
}
