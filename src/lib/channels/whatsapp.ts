import { getWhatsappConfig } from "./whatsapp-config";

import type {
  ChannelAdapter,
  InboundMessage,
  OutboundResult,
} from "./types";

// Meta webhook verification handshake (GET). Returns the challenge on success.
// Async because the verify token can be configured in the dashboard.
export async function verifyWhatsappWebhook(
  url: URL,
  env: unknown,
): Promise<Response> {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const { verifyToken } = await getWhatsappConfig(env);
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Normalize a Meta Cloud API webhook payload into inbound messages.
export function parseWhatsappInbound(body: unknown): InboundMessage[] {
  const typed = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: Array<{ profile?: { name?: string } }>;
          messages?: Array<{
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
          }>;
        };
      }>;
    }>;
  };
  const out: InboundMessage[] = [];
  for (const entry of typed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const name = value?.contacts?.[0]?.profile?.name ?? null;
      for (const message of value?.messages ?? []) {
        if (message.type !== "text" || !message.from) continue;
        const from = message.from.startsWith("+")
          ? message.from
          : `+${message.from}`;
        out.push({
          channel: "whatsapp",
          handle: from,
          platformUserId: from,
          name,
          text: message.text?.body ?? "",
          providerMsgId: message.id ?? null,
        });
      }
    }
  }
  return out;
}

export const whatsappAdapter: ChannelAdapter = {
  id: "whatsapp",
  capabilities: {
    canSendText: true,
    canSendMedia: true,
    canReceiveReceipts: true,
    requiresWebhookVerify: true,
    outboundMode: "push",
  },
  parseInbound(body) {
    return parseWhatsappInbound(body);
  },
  // Send order honours the transport preference:
  //   auto   -> Baileys bridge -> official Cloud API -> simulated
  //   bridge -> Baileys bridge -> simulated
  //   cloud  -> official Cloud API -> simulated
  async send(handle, text, env, venue, options): Promise<OutboundResult> {
    const { token, phoneId, bridgeUrl, bridgeToken, transport } =
      await getWhatsappConfig(env, venue, options?.accountId);

    if (bridgeUrl && transport !== "cloud") {
      try {
        const res = await fetch(`${bridgeUrl}/send`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(bridgeToken
              ? { authorization: `Bearer ${bridgeToken}` }
              : {}),
          },
          body: JSON.stringify({ to: handle, text, idempotencyKey: options?.idempotencyKey }),
        });
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean; id?: string };
          if (data.ok && data.id) {
            return {
              delivery: "accepted",
              providerMessageId: data.id,
              providerCode: String(res.status),
              retryable: false,
            };
          }
        }
        return {
          delivery: "failed",
          providerCode: String(res.status),
          retryable: res.status === 429 || res.status >= 500,
          error: "bridge rejected message",
        };
      } catch {
        return {
          delivery: "unknown",
          retryable: false,
          error: "bridge outcome unknown",
        };
      }
    }

    if (token && phoneId && transport !== "bridge") {
      try {
        const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            options?.template
              ? {
                  messaging_product: "whatsapp",
                  to: handle,
                  type: "template",
                  template: {
                    name: options.template.name,
                    language: { code: options.template.locale },
                  },
                }
                : {
                  messaging_product: "whatsapp",
                  to: handle,
                  type: "text",
                  text: { body: text },
                  biz_opaque_callback_data: options?.idempotencyKey,
                },
          ),
        });
        if (!response.ok) {
          return {
            delivery: "failed",
            providerCode: String(response.status),
            retryable: response.status === 429 || response.status >= 500,
          };
        }
        const body = (await response.json().catch(() => null)) as
          | { messages?: Array<{ id?: string }>; error?: unknown }
          | null;
        return body?.messages?.[0]?.id
          ? {
              delivery: "accepted",
              providerMessageId: body.messages[0].id,
              providerCode: String(response.status),
              retryable: false,
            }
          : {
              delivery: "unknown",
              providerCode: String(response.status),
              retryable: false,
              error: "provider accepted request without a message id",
            };
      } catch {
        return {
          delivery: "unknown",
          retryable: true,
          error: "network outcome unknown",
        };
      }
    }

    return {
      delivery: "failed",
      retryable: false,
      error: "channel credentials missing",
    };
  },
};
