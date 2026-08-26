import type { ChannelId } from "@/lib/channels/types";
import { getSql, type QuerySql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { hourAtOffset, withinQuietHours } from "@/lib/quiet-hours";

export type MessagePurpose =
  | "marketing"
  | "utility"
  | "transactional"
  | "authentication";

export type OutboundPolicyRequest = {
  venue: string;
  channel: ChannelId;
  handle: string;
  purpose: MessagePurpose;
  templateId?: string | null;
  accountId?: string | null;
  now?: Date;
  replyToInbound?: boolean;
  allowSuppressionConfirmation?: boolean;
};

export type OutboundPolicyDecision = {
  allowed: boolean;
  status: "authorized" | "suppressed" | "deferred" | "denied";
  reason?: string;
  retryAt?: string;
  snapshot: Record<string, unknown>;
};

type Sql = NonNullable<ReturnType<typeof getSql>>;

export function isWithinMessagingWindow(
  lastInbound: Date | null,
  now: Date,
  hours = 24,
): boolean {
  if (!lastInbound) return false;
  const elapsed = now.getTime() - lastInbound.getTime();
  return elapsed >= 0 && elapsed <= hours * 60 * 60 * 1000;
}

export function channelWindowDecision(input: {
  channel: ChannelId;
  lastInbound: Date | null;
  now: Date;
  templateApproved?: boolean;
  replyToInbound?: boolean;
}): { allowed: boolean; reason?: string } {
  const withinWindow = isWithinMessagingWindow(input.lastInbound, input.now);
  if (input.channel === "whatsapp" && !withinWindow && !input.templateApproved) {
    return { allowed: false, reason: "approved WhatsApp template required outside the 24-hour window" };
  }
  if (input.channel === "instagram" && !withinWindow) {
    return { allowed: false, reason: "Instagram automated messaging window closed" };
  }
  if (input.channel === "telegram" && !input.lastInbound && !input.replyToInbound) {
    return { allowed: false, reason: "telegram recipient has not initiated the conversation" };
  }
  return { allowed: true };
}

async function hasConsent(
  sql: Sql,
  request: OutboundPolicyRequest,
): Promise<boolean> {
  const [row] = await sql`
    SELECT state FROM channel_consent_events
    WHERE venue_id = ${request.venue} AND channel = ${request.channel}
      AND handle = ${request.handle} AND purpose = ${request.purpose}
      AND effective_at <= ${request.now ?? new Date()}
    ORDER BY effective_at DESC, created_at DESC LIMIT 1`;
  return row?.state === "granted";
}

async function recentInbound(sql: Sql, request: OutboundPolicyRequest): Promise<Date | null> {
  const storedHandle = request.handle.startsWith(`${request.channel}:`)
    ? request.handle
    : `${request.channel}:${request.handle}`;
  const [row] = await sql`
    SELECT c.last_inbound_at AS occurred_at
    FROM conversations c
    WHERE c.venue_id = ${request.venue} AND c.channel = ${request.channel}
      AND c.wa_id = ${storedHandle}
    LIMIT 1`;
  return row?.occurred_at ? new Date(row.occurred_at) : null;
}

async function approvedTemplate(
  sql: Sql,
  request: OutboundPolicyRequest,
): Promise<boolean> {
  if (!request.templateId) return false;
  const [row] = await sql`
    SELECT 1 FROM channel_templates
    WHERE id = ${request.templateId} AND venue_id = ${request.venue}
      AND channel = ${request.channel} AND approved
      AND account_id = ${request.accountId ?? ""}
      AND category = ${request.purpose === "transactional" ? "utility" : request.purpose}`;
  return Boolean(row);
}

export async function recordConsentEvent(
  sql: QuerySql,
  input: {
    venue: string;
    channel: string;
    handle: string;
    purpose: MessagePurpose;
    state: "granted" | "withdrawn";
    source: string;
    evidence?: Record<string, unknown>;
    actor?: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO channel_consent_events
      (venue_id, channel, handle, purpose, state, source, evidence, actor)
    VALUES (${input.venue}, ${input.channel}, ${input.handle}, ${input.purpose},
            ${input.state}, ${input.source}, ${sql.json(JSON.parse(JSON.stringify(input.evidence ?? {})))},
            ${input.actor ?? null})`;
}

export async function authorizeOutbound(
  env: unknown,
  request: OutboundPolicyRequest,
): Promise<OutboundPolicyDecision> {
  const sql = getSql(env);
  if (!sql) {
    return {
      allowed: false,
      status: "denied",
      reason: "compliance store unavailable",
      snapshot: { failClosed: true },
    };
  }
  const now = request.now ?? new Date();
  const basis: Record<string, unknown> = {
    checkedAt: now.toISOString(),
    purpose: request.purpose,
    channel: request.channel,
    accountId: request.accountId ?? null,
    suppressionConfirmation: request.allowSuppressionConfirmation ?? false,
  };
  try {
    const [suppressed] = await sql`
      SELECT 1 FROM suppressions
      WHERE venue_id = ${request.venue} AND channel = ${request.channel}
        AND handle = ${request.handle} LIMIT 1`;
    if (suppressed && !request.allowSuppressionConfirmation) {
      return {
        allowed: false,
        status: "suppressed",
        reason: "recipient opted out",
        snapshot: { checkedAt: now.toISOString(), suppressed: true },
      };
    }

    if (request.channel === "sms" && request.purpose !== "authentication") {
      const start = Number(envVar(env, "SMS_QUIET_START") ?? "21");
      const end = Number(envVar(env, "SMS_QUIET_END") ?? "8");
      const offset = Number(envVar(env, "SMS_TZ_OFFSET_MIN") ?? "180");
      if (withinQuietHours(hourAtOffset(now, offset), start, end)) {
        const retryAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
        return {
          allowed: false,
          status: "deferred",
          reason: "sms quiet hours",
          retryAt,
          snapshot: { checkedAt: now.toISOString(), quietHours: { start, end, offset } },
        };
      }
    }

    const consentRequired = request.purpose === "marketing";
    if (consentRequired && !(await hasConsent(sql, { ...request, now }))) {
      return {
        allowed: false,
        status: "denied",
        reason: "affirmative marketing consent required",
        snapshot: { checkedAt: now.toISOString(), consent: false },
      };
    }
    if (consentRequired) basis.consent = "granted";

    if (
      request.channel === "telegram" &&
      request.purpose !== "authentication" &&
      !request.replyToInbound
    ) {
      const lastInbound = await recentInbound(sql, request);
      const window = channelWindowDecision({
        channel: request.channel,
        lastInbound,
        now,
        replyToInbound: request.replyToInbound,
      });
      if (!window.allowed) {
        return {
          allowed: false,
          status: "denied",
          reason: window.reason,
          snapshot: { checkedAt: now.toISOString(), initiated: false },
        };
      }
      basis.initiated = true;
    }

    if (request.channel === "whatsapp") {
      const inbound = await recentInbound(sql, request);
      const templateApproved = await approvedTemplate(sql, request);
      const window = channelWindowDecision({
        channel: request.channel,
        lastInbound: inbound,
        now,
        templateApproved,
        replyToInbound: request.replyToInbound,
      });
      if (!window.allowed) {
        return {
          allowed: false,
          status: "denied",
          reason: window.reason,
          snapshot: { checkedAt: now.toISOString(), withinWindow: isWithinMessagingWindow(inbound, now), templateApproved },
        };
      }
      basis.withinWindow = isWithinMessagingWindow(inbound, now);
      basis.templateApproved = templateApproved;
    }

    if (request.channel === "instagram" && request.purpose !== "authentication") {
      const inbound = await recentInbound(sql, request);
      const window = channelWindowDecision({
        channel: request.channel,
        lastInbound: inbound,
        now,
        replyToInbound: request.replyToInbound,
      });
      if (!window.allowed) {
        return {
          allowed: false,
          status: "denied",
          reason: window.reason,
          snapshot: { checkedAt: now.toISOString(), withinWindow: isWithinMessagingWindow(inbound, now) },
        };
      }
      basis.withinWindow = isWithinMessagingWindow(inbound, now);
    }

    return {
      allowed: true,
      status: "authorized",
      snapshot: basis,
    };
  } catch {
    return {
      allowed: false,
      status: "denied",
      reason: "compliance store unavailable",
      snapshot: { checkedAt: now.toISOString(), failClosed: true },
    };
  }
}
