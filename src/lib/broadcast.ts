import { getAdapter } from "@/lib/channels";
import type { ChannelId } from "@/lib/channels/types";
import { isSuppressed } from "@/lib/consent";
import { getSql } from "@/lib/db";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type BroadcastParams = {
  venue: string;
  segment: "all" | "gold_plus" | "lapsed";
  channel: ChannelId;
  message: string;
};

export type BroadcastResult = {
  total: number;
  sent: number;
  simulated: number;
  failed: number;
  suppressed: number;
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
  const rows = await sql`
    SELECT pi.platform_user_id AS handle, p.display_name AS name
    FROM platform_identities pi
    JOIN persons p ON p.id = pi.person_id
    WHERE pi.venue_id = ${venue} AND pi.channel = ${channel}`;
  return rows.map((row) => ({ handle: row.handle, name: row.name ?? null }));
}

// Segmented bulk send across a channel. Delivers via the channel adapter,
// reflects each message in the recipient's Inbox thread, and logs every send to
// the event store (for history + DLQ). Best-effort per recipient.
export async function sendBroadcast(
  env: unknown,
  params: BroadcastParams,
): Promise<BroadcastResult> {
  const sql = getSql(env);
  if (!sql) {
    return {
      total: 0,
      sent: 0,
      simulated: 0,
      failed: 0,
      suppressed: 0,
      channel: params.channel,
      segment: params.segment,
      error: "database not configured",
    };
  }
  const { venue, segment, channel, message } = params;
  const adapter = getAdapter(channel);
  const recipients = await resolveRecipients(sql, venue, channel, segment);

  const [venueRow] = await sql`SELECT name FROM venues WHERE id = ${venue}`;
  const venueName = venueRow?.name ?? venue;

  const personalize = (name: string | null): string =>
    message
      .replace(/\{\{\s*name\s*\}\}/g, name ?? "there")
      .replace(/\{\{\s*venue\s*\}\}/g, venueName);

  let sent = 0;
  let simulated = 0;
  let failed = 0;
  let suppressed = 0;

  for (const recipient of recipients) {
    // Compliance: never send to a handle that has opted out (STOP) on this channel.
    if (await isSuppressed(sql, venue, channel, recipient.handle)) {
      suppressed += 1;
      continue;
    }
    const text = personalize(recipient.name);
    try {
      const out = await adapter.send(recipient.handle, text, env);
      if (out.delivery === "sent") sent += 1;
      else simulated += 1;

      const [conversation] = await sql`
        INSERT INTO conversations (venue_id, wa_id, name, role, channel)
        VALUES (${venue}, ${recipient.handle}, ${recipient.name}, 'customer', ${channel})
        ON CONFLICT (venue_id, wa_id) DO UPDATE SET last_message_at = now()
        RETURNING id`;
      await sql`
        INSERT INTO messages (conversation_id, direction, body, ai, channel)
        VALUES (${conversation.id}, 'outbound', ${text}, false, ${channel})`;
      await sql`
        INSERT INTO events (venue_id, channel, direction, conversation_id, type, status)
        VALUES (${venue}, ${channel}, 'outbound', ${conversation.id}, 'broadcast', ${out.delivery})`;
    } catch {
      failed += 1;
      try {
        await sql`
          INSERT INTO events (venue_id, channel, direction, type, status, payload)
          VALUES (${venue}, ${channel}, 'outbound', 'broadcast', 'failed',
                  ${sql.json({ handle: recipient.handle })})`;
      } catch {
        /* ignore logging failure */
      }
    }
  }

  return {
    total: recipients.length,
    sent,
    simulated,
    failed,
    suppressed,
    channel,
    segment,
  };
}
