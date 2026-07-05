import { runAgent, type AgentRole } from "@/lib/agent";
import { getAdapter } from "@/lib/channels";
import type { InboundMessage } from "@/lib/channels/types";
import { getSql } from "@/lib/db";
import { notifyStaff } from "@/lib/push";

export type InboundResult = {
  conversationId?: string;
  role?: AgentRole;
  reply?: string;
  tool?: string;
  escalate?: boolean;
  delivery?: string;
  deduped?: boolean;
  error?: string;
};

type Sql = NonNullable<ReturnType<typeof getSql>>;

// Resolve (or create) the Person behind this message and link the channel
// identity. Best-effort: identity enrichment must never break message flow.
async function linkIdentity(
  sql: Sql,
  venue: string,
  msg: InboundMessage,
): Promise<string | null> {
  try {
    const [existing] = await sql`
      SELECT person_id FROM platform_identities
      WHERE venue_id = ${venue} AND channel = ${msg.channel}
        AND platform_user_id = ${msg.platformUserId}`;
    if (existing?.person_id) return existing.person_id;

    // WhatsApp/SMS handles are phone numbers — reuse a matching Person so the
    // same human on multiple channels collapses to one identity.
    const phone = msg.handle.startsWith("+") ? msg.handle : null;
    let personId: string | null = null;
    if (phone) {
      const [byPhone] = await sql`
        SELECT id FROM persons
        WHERE venue_id = ${venue} AND primary_phone = ${phone} LIMIT 1`;
      personId = byPhone?.id ?? null;
    }
    if (!personId) {
      const [created] = await sql`
        INSERT INTO persons (venue_id, display_name, primary_phone)
        VALUES (${venue}, ${msg.name}, ${phone})
        RETURNING id`;
      personId = created.id;
    }
    await sql`
      INSERT INTO platform_identities
        (person_id, venue_id, channel, platform_user_id, linked_by)
      VALUES (${personId}, ${venue}, ${msg.channel}, ${msg.platformUserId},
              ${phone ? "auto_phone" : "initial"})
      ON CONFLICT (venue_id, channel, platform_user_id) DO NOTHING`;
    return personId;
  } catch {
    return null;
  }
}

// The channel-agnostic 24/7 pipeline: dedupe -> persist inbound -> identity ->
// run the agent -> persist + deliver reply -> notify staff. Shared by every
// channel (WhatsApp webhook, web chat, and future Telegram/IG/SMS adapters).
export async function processInbound(
  msg: InboundMessage,
  venue: string,
  env: unknown,
): Promise<InboundResult> {
  const sql = getSql(env);
  if (!sql) return { error: "database not configured" };

  // 1. Durable event log + inbound dedupe. When a provider message id is
  //    present and already seen, the insert conflicts and we stop (idempotent).
  const inboundEvent = await sql`
    INSERT INTO events (venue_id, channel, direction, provider_msg_id, type, status)
    VALUES (${venue}, ${msg.channel}, 'inbound', ${msg.providerMsgId}, 'message', 'received')
    ON CONFLICT (channel, provider_msg_id) WHERE provider_msg_id IS NOT NULL
      DO NOTHING
    RETURNING id`;
  if (inboundEvent.length === 0) return { deduped: true };

  // 2. Role from the allowlist (staff/admin numbers unlock CRM tools).
  const [allow] = await sql`
    SELECT role FROM wa_allowlist
    WHERE phone = ${msg.platformUserId} AND venue_id = ${venue}`;
  const role: AgentRole = allow
    ? allow.role === "admin"
      ? "admin"
      : "staff"
    : "customer";

  // 3. Identity graph.
  const personId = await linkIdentity(sql, venue, msg);

  // 4. Upsert the conversation (channel-scoped handle keeps this collision-free).
  const [conversation] = await sql`
    INSERT INTO conversations (venue_id, wa_id, name, role, channel, person_id)
    VALUES (${venue}, ${msg.handle}, ${msg.name}, ${role}, ${msg.channel}, ${personId})
    ON CONFLICT (venue_id, wa_id) DO UPDATE
      SET last_message_at = now(),
          name = COALESCE(EXCLUDED.name, conversations.name),
          person_id = COALESCE(conversations.person_id, EXCLUDED.person_id)
    RETURNING id`;

  await sql`
    INSERT INTO messages (conversation_id, direction, body, channel)
    VALUES (${conversation.id}, 'inbound', ${msg.text}, ${msg.channel})`;

  // 5. Run the agent.
  const result = await runAgent(
    msg.text,
    { venue, role, from: msg.platformUserId, name: msg.name ?? undefined },
    env,
  );

  // 6. Persist the reply + status.
  await sql`
    INSERT INTO messages (conversation_id, direction, body, ai, tool, channel)
    VALUES (${conversation.id}, 'outbound', ${result.reply}, true, ${result.tool ?? null}, ${msg.channel})`;
  if (result.escalate) {
    await sql`UPDATE conversations SET status = 'escalated' WHERE id = ${conversation.id}`;
  }
  await sql`UPDATE conversations SET last_message_at = now() WHERE id = ${conversation.id}`;

  // 7. Deliver on the channel (push channels send now; pull channels are fetched
  //    by the client). Record the true delivery status — failures land in the
  //    DLQ (events.status = 'failed') with enough payload to retry.
  let delivery = "pull";
  let failed = false;
  try {
    const out = await getAdapter(msg.channel).send(msg.handle, result.reply, env);
    delivery = out.delivery;
  } catch {
    delivery = "failed";
    failed = true;
  }
  await sql`
    INSERT INTO events (venue_id, channel, direction, conversation_id, type, status, payload)
    VALUES (${venue}, ${msg.channel}, 'outbound', ${conversation.id}, 'message',
            ${failed ? "failed" : delivery},
            ${failed ? sql.json({ handle: msg.handle, text: result.reply }) : null})`;

  // 8. Nudge staff devices when a human is needed or a customer messages in.
  if (role === "customer") {
    await notifyStaff(
      env,
      venue,
      result.escalate ? "Conversation escalated" : `New ${msg.channel} message`,
      `${msg.name ?? msg.handle}: ${msg.text}`.slice(0, 120),
    );
  }

  return {
    conversationId: conversation.id,
    role,
    reply: result.reply,
    tool: result.tool,
    escalate: result.escalate ?? false,
    delivery,
  };
}
