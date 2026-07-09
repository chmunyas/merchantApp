import { getTelegramConfig } from "./telegram-config";

import type {
  ChannelAdapter,
  InboundMessage,
  OutboundResult,
} from "./types";

// Normalize a Telegram Bot API update into inbound messages.
export function parseTelegramInbound(body: unknown): InboundMessage[] {
  const update = body as {
    message?: {
      message_id?: number;
      text?: string;
      from?: { id?: number; first_name?: string; username?: string };
      chat?: { id?: number };
    };
  };
  const message = update.message;
  if (!message?.text || message.chat?.id == null) return [];
  const chatId = String(message.chat.id);
  const name =
    message.from?.first_name ??
    (message.from?.username ? `@${message.from.username}` : null);
  return [
    {
      channel: "telegram",
      handle: `tg:${chatId}`,
      platformUserId: `tg:${message.from?.id ?? chatId}`,
      name,
      text: message.text,
      providerMsgId:
        message.message_id != null ? `tg:${chatId}:${message.message_id}` : null,
    },
  ];
}

export const telegramAdapter: ChannelAdapter = {
  id: "telegram",
  capabilities: {
    canSendText: true,
    canSendMedia: true,
    canReceiveReceipts: false,
    requiresWebhookVerify: false,
    outboundMode: "push",
  },
  parseInbound(body) {
    return parseTelegramInbound(body);
  },
  async send(handle, text, env, venue): Promise<OutboundResult> {
    const { botToken } = await getTelegramConfig(env, venue);
    if (!botToken) return { delivery: "simulated" };
    const chatId = handle.replace(/^tg:/, "");
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        },
      );
      // Telegram returns HTTP 200 with {ok:true} on success, or a 4xx with
      // {ok:false} (e.g. "chat not found"). fetch does not throw on 4xx, so
      // inspect the body to avoid reporting a rejected send as delivered.
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      if (res.ok && data?.ok) return { delivery: "sent" };
      return { delivery: "simulated" };
    } catch {
      return { delivery: "simulated" };
    }
  },
};
