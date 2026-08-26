import { envVar } from "@/lib/env";

import type {
  ChannelAdapter,
  InboundMessage,
  OutboundResult,
} from "./types";

// Extract the bare address from a "Name <addr@x.com>" or raw "addr@x.com" string.
function extractEmail(raw: string): string {
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

// Normalize an inbound email (ESP inbound-parse webhook) into a message.
// Supports SendGrid Inbound Parse (from/text/subject), Mailgun (sender/body-plain)
// and a plain JSON { from, text, subject } shape from the simulator.
export function parseEmailInbound(body: unknown): InboundMessage[] {
  const b = body as {
    from?: string;
    sender?: string;
    text?: string;
    "body-plain"?: string;
    subject?: string;
    "message-id"?: string;
    messageId?: string;
  };
  const rawFrom = b.from ?? b.sender;
  const text = b.text ?? b["body-plain"] ?? b.subject;
  if (!rawFrom || !text) return [];
  const email = extractEmail(rawFrom);
  if (!email.includes("@")) return [];
  const name = rawFrom.replace(/<[^>]+>/, "").replace(/["']/g, "").trim();
  const id = b["message-id"] ?? b.messageId;
  return [
    {
      channel: "email",
      handle: email,
      platformUserId: email,
      name: name || null,
      text: String(text),
      providerMsgId: id ? `email:${id}` : null,
    },
  ];
}

export const emailAdapter: ChannelAdapter = {
  id: "email",
  capabilities: {
    canSendText: true,
    canSendMedia: false,
    canReceiveReceipts: false,
    requiresWebhookVerify: false,
    outboundMode: "push",
  },
  parseInbound(body) {
    return parseEmailInbound(body);
  },
  // Send via Resend or SendGrid. Provider acceptance is not final delivery.
  async send(handle, text, env, _venue, options): Promise<OutboundResult> {
    const to = handle.replace(/^email:/, "").trim();
    const from = envVar(env, "EMAIL_FROM");
    const resend = envVar(env, "RESEND_API_KEY");
    const sendgrid = envVar(env, "SENDGRID_API_KEY");
    const subject = envVar(env, "EMAIL_SUBJECT") ?? "A message from your venue";
    if (!to.includes("@") || !from || (!resend && !sendgrid)) {
      return {
        delivery: "failed",
        retryable: false,
        error: "channel credentials missing",
      };
    }
    try {
      if (resend) {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${resend}`,
            "content-type": "application/json",
            ...(options?.idempotencyKey
              ? { "idempotency-key": options.idempotencyKey }
              : {}),
          },
          body: JSON.stringify({ from, to, subject, text }),
        });
        const body = (await response.json().catch(() => null)) as
          | { id?: string; message?: string }
          | null;
        if (!response.ok) {
          return {
            delivery: "failed",
            providerCode: String(response.status),
            retryable: response.status === 429 || response.status >= 500,
            error: body?.message,
          };
        }
        return {
          delivery: "accepted",
          providerMessageId: body?.id,
          providerCode: String(response.status),
          retryable: false,
        };
      } else {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            authorization: `Bearer ${sendgrid}`,
            "content-type": "application/json",
            ...(options?.idempotencyKey
              ? { "x-smtpapi": JSON.stringify({ unique_args: { delivery_key: options.idempotencyKey } }) }
              : {}),
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: from },
            subject,
            content: [{ type: "text/plain", value: text }],
          }),
        });
        if (!response.ok) {
          return {
            delivery: "failed",
            providerCode: String(response.status),
            retryable: response.status === 429 || response.status >= 500,
          };
        }
        return {
          delivery: "accepted",
          providerMessageId: response.headers.get("x-message-id") ?? undefined,
          providerCode: String(response.status),
          retryable: false,
        };
      }
    } catch {
      return {
        delivery: "unknown",
        retryable: true,
        error: "network outcome unknown",
      };
    }
  },
};
