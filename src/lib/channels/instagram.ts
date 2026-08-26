import { envVar } from "@/lib/env";

import type {
  ChannelAdapter,
  InboundMessage,
  OutboundResult,
} from "./types";

// Instagram / Messenger share Meta's hub.challenge verification handshake.
export function verifyMetaWebhook(url: URL, env: unknown): Response | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected =
    envVar(env, "INSTAGRAM_VERIFY_TOKEN") ??
    envVar(env, "WHATSAPP_VERIFY_TOKEN") ??
    "pesaswap-verify";
  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Normalize an Instagram messaging webhook payload into inbound messages.
export function parseInstagramInbound(body: unknown): InboundMessage[] {
  const typed = body as {
    entry?: Array<{
      messaging?: Array<{
        sender?: { id?: string };
        message?: { mid?: string; text?: string };
      }>;
    }>;
  };
  const out: InboundMessage[] = [];
  for (const entry of typed.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const text = event.message?.text;
      const senderId = event.sender?.id;
      if (!text || !senderId) continue;
      out.push({
        channel: "instagram",
        handle: `ig:${senderId}`,
        platformUserId: `ig:${senderId}`,
        name: null,
        text,
        providerMsgId: event.message?.mid ? `ig:${event.message.mid}` : null,
      });
    }
  }
  return out;
}

export const instagramAdapter: ChannelAdapter = {
  id: "instagram",
  capabilities: {
    canSendText: true,
    canSendMedia: true,
    canReceiveReceipts: false,
    requiresWebhookVerify: true,
    outboundMode: "push",
  },
  verifyWebhook(url, env) {
    return verifyMetaWebhook(url, env);
  },
  parseInbound(body) {
    return parseInstagramInbound(body);
  },
  async send(handle, text, env): Promise<OutboundResult> {
    const token = envVar(env, "INSTAGRAM_TOKEN");
    if (!token) {
      return {
        delivery: "failed",
        retryable: false,
        error: "channel credentials missing",
      };
    }
    const recipientId = handle.replace(/^ig:/, "");
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/me/messages?access_token=${token}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text },
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { message_id?: string; error?: { message?: string; code?: number } }
        | null;
      if (!response.ok) {
        return {
          delivery: "failed",
          providerCode: String(body?.error?.code ?? response.status),
          retryable: response.status === 429 || response.status >= 500,
          error: body?.error?.message,
        };
      }
      return body?.message_id
        ? {
            delivery: "accepted",
            providerMessageId: body.message_id,
            providerCode: String(response.status),
            retryable: false,
          }
        : {
            delivery: "unknown",
            providerCode: String(response.status),
            retryable: false,
          };
    } catch {
      return {
        delivery: "unknown",
        retryable: true,
        error: "network outcome unknown",
      };
    }
  },
};
