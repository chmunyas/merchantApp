import { requireAuth } from "@/api/auth";
import { getAdapter } from "@/lib/channels";
import { isSuppressed } from "@/lib/consent";
import { getSql } from "@/lib/db";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

const SHARE_CHANNELS = new Set(["whatsapp", "telegram", "sms"]);

// Normalize a recipient into a channel handle. Phones become E.164 (a leading 0
// is treated as Kenya, the primary M-Pesa market); Telegram takes a chat id or
// @username.
function toHandle(channel: string, to: string): string | null {
  const raw = String(to ?? "").trim();
  if (!raw) return null;
  if (channel === "telegram") {
    if (raw.startsWith("tg:")) return raw;
    return `tg:${raw.replace(/^@/, "")}`;
  }
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  if (digits.startsWith("254")) return `+${digits}`;
  return `+${digits}`;
}

// Reflect the sent message into the customer's conversation thread so it appears
// in the inbox. Best-effort — never blocks the send.
async function logOutbound(
  env: unknown,
  venue: string,
  handle: string,
  name: string | null,
  body: string,
  tool: string,
): Promise<void> {
  const sql = getSql(env);
  if (!sql) return;
  try {
    const [conv] = await sql`
      INSERT INTO conversations (venue_id, wa_id, name)
      VALUES (${venue}, ${handle}, ${name})
      ON CONFLICT (venue_id, wa_id)
      DO UPDATE SET last_message_at = now(),
                    name = COALESCE(conversations.name, EXCLUDED.name)
      RETURNING id`;
    if (conv?.id) {
      await sql`
        INSERT INTO messages (conversation_id, direction, body, tool)
        VALUES (${conv.id}, 'outbound', ${body}, ${tool})`;
    }
  } catch {
    /* best-effort */
  }
}

// Merchant-initiated outbound share/send over any configured channel. Lets the
// app push a payment link, QR link, invoice, booking or enquiry to a customer on
// WhatsApp / Telegram / SMS using the venue's configured number + keys.
export async function handleShareRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/share") return null;
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);

  const body = (await request.json().catch(() => ({}))) as {
    channel?: string;
    to?: string;
    text?: string;
    link?: string;
    name?: string;
    kind?: string;
  };

  const channel = String(body.channel ?? "whatsapp").toLowerCase();
  if (!SHARE_CHANNELS.has(channel)) {
    return json({ error: "unsupported channel" }, 400);
  }
  const handle = toHandle(channel, body.to ?? "");
  if (!handle) return json({ error: "recipient required" }, 400);

  const message = [body.text?.trim(), body.link?.trim()]
    .filter(Boolean)
    .join("\n\n");
  if (!message) return json({ error: "message required" }, 400);

  // Consent: never message a handle that has opted out (omnichannel compliance).
  const sql = getSql(env);
  if (sql && (await isSuppressed(sql, venue, channel, handle))) {
    return json({ ok: false, delivery: "suppressed", to: handle });
  }

  const result = await getAdapter(channel).send(handle, message, env, venue);
  await logOutbound(
    env,
    venue,
    handle,
    body.name?.trim() || null,
    message,
    body.kind ?? "share",
  );

  return json({ ok: true, channel, to: handle, delivery: result.delivery });
}
