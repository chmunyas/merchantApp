import { envVar } from "@/lib/env";

import type {
  ChannelAdapter,
  InboundMessage,
  OutboundResult,
} from "./types";

// Normalize an inbound SMS callback (Africa's Talking form or JSON) into a
// message. The route converts form-encoded bodies into this plain object shape.
export function parseSmsInbound(body: unknown): InboundMessage[] {
  const b = body as {
    from?: string;
    phoneNumber?: string;
    text?: string;
    message?: string;
    id?: string;
    linkId?: string;
  };
  const rawFrom = b.from ?? b.phoneNumber;
  const text = b.text ?? b.message;
  if (!rawFrom || !text) return [];
  const phone = rawFrom.startsWith("+") ? rawFrom : `+${rawFrom}`;
  const id = b.id ?? b.linkId;
  return [
    {
      channel: "sms",
      handle: phone,
      platformUserId: phone,
      name: null,
      text,
      providerMsgId: id ? `sms:${id}` : null,
    },
  ];
}

export const smsAdapter: ChannelAdapter = {
  id: "sms",
  capabilities: {
    canSendText: true,
    canSendMedia: false,
    canReceiveReceipts: true,
    requiresWebhookVerify: false,
    outboundMode: "push",
  },
  parseInbound(body) {
    return parseSmsInbound(body);
  },
  // Send via Africa's Talking (Kenya). Provider acceptance is not delivery.
  async send(handle, text, env): Promise<OutboundResult> {
    const apiKey = envVar(env, "AT_API_KEY");
    const username = envVar(env, "AT_USERNAME");
    if (!apiKey || !username) {
      return {
        delivery: "failed",
        retryable: false,
        error: "channel credentials missing",
      };
    }
    const params = new URLSearchParams({ username, to: handle, message: text });
    const senderId = envVar(env, "AT_SENDER_ID");
    if (senderId) params.set("from", senderId);
    try {
      const response = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });
      if (!response.ok) {
        return {
          delivery: "failed",
          providerCode: String(response.status),
          retryable: response.status === 429 || response.status >= 500,
        };
      }
      const body = (await response.json().catch(() => null)) as
        | {
            SMSMessageData?: {
              Recipients?: Array<{ status?: string; messageId?: string }>;
            };
          }
        | null;
      const recipients = body?.SMSMessageData?.Recipients ?? [];
      return recipients.length > 0 && recipients.every((recipient) =>
        /success/i.test(String(recipient.status ?? "")),
      )
        ? {
            delivery: "accepted",
            providerMessageId: recipients[0]?.messageId,
            providerCode: String(response.status),
            retryable: false,
          }
        : {
            delivery: "failed",
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
