import { runAgent, type AgentRole } from "@/lib/agent";
import type { InboundMessage } from "@/lib/channels/types";
import { getSql } from "@/lib/db";
import { consentKeyword, isSuppressed, setSuppressed } from "@/lib/consent";
import { queueOutbound } from "@/lib/outbound-jobs";
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

function conversationHandle(msg: InboundMessage): string {
  return msg.handle.startsWith(`${msg.channel}:`)
    ? msg.handle
    : `${msg.channel}:${msg.handle}`;
}

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
  accountId = "internal",
  ingressId?: string,
  receivedAt?: Date,
): Promise<InboundResult> {
  const sql = getSql(env);
  if (!sql) return { error: "database not configured" };

  // 1. Durable event log + inbound dedupe. When a provider message id is
  //    present and already seen, the insert conflicts and we stop (idempotent).
  const eventKey = ingressId ?? crypto.randomUUID();

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
  const storedHandle = conversationHandle(msg);
  const [conversation] = await sql`
    INSERT INTO conversations
      (venue_id, wa_id, name, role, channel, person_id, last_inbound_at)
        VALUES (${venue}, ${storedHandle}, ${msg.name}, ${role}, ${msg.channel},
          ${personId}, ${receivedAt ?? new Date()})
    ON CONFLICT (venue_id, channel, wa_id) DO UPDATE
        SET last_message_at = GREATEST(conversations.last_message_at, ${receivedAt ?? new Date()}),
          last_inbound_at = GREATEST(
            COALESCE(conversations.last_inbound_at, '-infinity'::timestamptz),
            ${receivedAt ?? new Date()}
          ),
          name = COALESCE(EXCLUDED.name, conversations.name),
          person_id = COALESCE(conversations.person_id, EXCLUDED.person_id)
    RETURNING id`;

  await sql`
    INSERT INTO messages (conversation_id, direction, body, channel, ingress_id)
    VALUES (${conversation.id}, 'inbound', ${msg.text}, ${msg.channel}, ${ingressId ?? null})
    ON CONFLICT (ingress_id, direction) WHERE ingress_id IS NOT NULL DO NOTHING`;

  // 4a. Consent / suppression (compliance). STOP opts this handle out of outbound
  //     on this channel; START opts back in — both get a transactional reply.
  const keyword = consentKeyword(msg.text);
  if (keyword === "stop" || keyword === "start" || keyword === "help") {
    if (keyword !== "help") {
      await setSuppressed(sql, venue, msg.channel, msg.handle, keyword === "stop");
    }
    const confirm =
      keyword === "stop"
        ? "You've been unsubscribed and won't receive further messages. Reply START to opt back in."
        : keyword === "start"
          ? "You're opted back in. How can we help?"
          : "For help, reply with your question. Reply STOP to opt out of messages.";
    await sql`
      INSERT INTO messages
        (conversation_id, direction, body, ai, channel, ingress_id)
      VALUES (${conversation.id}, 'outbound', ${confirm}, false, ${msg.channel},
              ${ingressId ?? null})
      ON CONFLICT (ingress_id, direction) WHERE ingress_id IS NOT NULL DO NOTHING`;
    await queueOutbound(env, {
      deliveryKey: `keyword:${eventKey}`,
      venue,
      sourceType: "keyword_reply",
      sourceId: eventKey,
      channel: msg.channel,
      handle: msg.handle,
      purpose: "utility",
      body: confirm,
    });
    await sql`UPDATE conversations SET last_message_at = now() WHERE id = ${conversation.id}`;
    return {
      conversationId: conversation.id,
      role,
      reply: confirm,
      delivery: "queued",
    };
  }
  const suppressed = await isSuppressed(sql, venue, msg.channel, msg.handle);

  // 5. Run the agent.
  const [existingReply] = ingressId
    ? await sql`
        SELECT body, tool FROM messages
        WHERE ingress_id = ${ingressId} AND direction = 'outbound' LIMIT 1`
    : [];
  const result = existingReply
    ? { reply: String(existingReply.body), tool: existingReply.tool ?? undefined, escalate: false }
    : await runAgent(
        msg.text,
        {
          venue,
          role,
          from: msg.platformUserId,
          name: msg.name ?? undefined,
          operationKey: ingressId,
        },
        env,
      );

  // 6. Persist the reply + status.
  await sql`
    INSERT INTO messages
      (conversation_id, direction, body, ai, tool, channel, ingress_id)
    VALUES (${conversation.id}, 'outbound', ${result.reply}, true,
            ${result.tool ?? null}, ${msg.channel}, ${ingressId ?? null})
    ON CONFLICT (ingress_id, direction) WHERE ingress_id IS NOT NULL DO NOTHING`;
  if (result.escalate) {
    await sql`UPDATE conversations SET status = 'escalated' WHERE id = ${conversation.id}`;
  }
  await sql`UPDATE conversations SET last_message_at = now() WHERE id = ${conversation.id}`;

  // 7. Deliver on the channel (push channels send now; pull channels are fetched
  //    by the client). Record the true delivery status — failures land in the
  //    DLQ (events.status = 'failed') with enough payload to retry.
  // Suppressed (opted-out) contacts: log the agent reply for staff but never
  // deliver unsolicited outbound.
  const delivery = suppressed ? "suppressed" : "queued";
  if (!suppressed) {
    await queueOutbound(env, {
      deliveryKey: `agent:${eventKey}`,
      venue,
      sourceType: "agent_reply",
      sourceId: eventKey,
      channel: msg.channel,
      handle: msg.handle,
      purpose: "utility",
      body: result.reply,
    });
  }
  await sql`
    INSERT INTO events (venue_id, channel, direction, conversation_id, type, status, payload)
    SELECT ${venue}, ${msg.channel}, 'outbound', ${conversation.id}, 'message',
           ${delivery}, ${sql.json({ handle: msg.handle, delivery_key: `agent:${eventKey}` })}
    WHERE NOT EXISTS (
      SELECT 1 FROM events
      WHERE venue_id = ${venue} AND channel = ${msg.channel}
        AND direction = 'outbound' AND payload->>'delivery_key' = ${`agent:${eventKey}`}
    )`;
  await sql`
    INSERT INTO events
      (venue_id, channel, direction, provider_msg_id, type, status, payload)
    VALUES (${venue}, ${msg.channel}, 'inbound', ${msg.providerMsgId}, 'message',
            'processed', ${sql.json({ account_id: accountId, ingress_id: ingressId ?? null })})
    ON CONFLICT (channel, (payload->>'account_id'), provider_msg_id)
      WHERE provider_msg_id IS NOT NULL AND payload->>'account_id' IS NOT NULL
      DO NOTHING`;

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
