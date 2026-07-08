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
  // Send via Resend or SendGrid. Falls back to "simulated" without credentials so
  // the pipeline works end-to-end in dev/demo. Set EMAIL_FROM + one of
  // RESEND_API_KEY / SENDGRID_API_KEY to go live.
  async send(handle, text, env): Promise<OutboundResult> {
    const to = handle.replace(/^email:/, "").trim();
    const from = envVar(env, "EMAIL_FROM");
    const resend = envVar(env, "RESEND_API_KEY");
    const sendgrid = envVar(env, "SENDGRID_API_KEY");
    const subject = envVar(env, "EMAIL_SUBJECT") ?? "A message from your venue";
    if (!to.includes("@") || !from || (!resend && !sendgrid)) {
      return { delivery: "simulated" };
    }
    try {
      if (resend) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${resend}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ from, to, subject, text }),
        });
      } else {
        await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            authorization: `Bearer ${sendgrid}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: from },
            subject,
            content: [{ type: "text/plain", value: text }],
          }),
        });
      }
      return { delivery: "sent" };
    } catch {
      return { delivery: "simulated" };
    }
  },
};
