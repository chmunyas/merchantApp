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
  async send(handle, text, env, venue): Promise<OutboundResult> {
    const { token, phoneId, bridgeUrl, bridgeToken, transport } =
      await getWhatsappConfig(env, venue);

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
          body: JSON.stringify({ to: handle, text }),
        });
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean };
          if (data.ok) return { delivery: "sent" };
        }
      } catch {
        /* bridge offline — fall back to Cloud API / simulated */
      }
    }

    if (token && phoneId && transport !== "bridge") {
      try {
        await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: handle,
            type: "text",
            text: { body: text },
          }),
        });
        return { delivery: "sent" };
      } catch {
        return { delivery: "simulated" };
      }
    }

    return { delivery: "simulated" };
  },
};
