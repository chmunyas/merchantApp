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
  async send(handle, text, env): Promise<OutboundResult> {
    const { botToken } = await getTelegramConfig(env);
    if (!botToken) return { delivery: "simulated" };
    const chatId = handle.replace(/^tg:/, "");
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      return { delivery: "sent" };
    } catch {
      return { delivery: "simulated" };
    }
  },
};
