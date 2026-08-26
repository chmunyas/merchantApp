import { requireAuth } from "@/api/auth";
import { queueOutbound } from "@/lib/outbound-jobs";
import { venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

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
const SHARE_PURPOSES = {
  invoice: "transactional",
  payment_link: "transactional",
  booking: "utility",
  enquiry: "utility",
} as const;

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
  if (!roleAtLeast(payload, "staff") || !tokenHasScope(payload, "messaging:write")) {
    return json({ error: "forbidden" }, 403);
  }
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
  const kind = String(body.kind ?? "");
  if (!(kind in SHARE_PURPOSES)) return json({ error: "valid share kind required" }, 400);

  const deliveryKey = request.headers.get("idempotency-key")?.trim();
  if (!deliveryKey) return json({ error: "Idempotency-Key header required" }, 400);
  const result = await queueOutbound(env, {
    deliveryKey: `share:${venue}:${deliveryKey}`,
    venue,
    sourceType: "share",
    sourceId: deliveryKey,
    channel: channel as "whatsapp" | "telegram" | "sms",
    handle,
    recipientName: body.name?.trim() || null,
    purpose: SHARE_PURPOSES[kind as keyof typeof SHARE_PURPOSES],
    body: message,
  });
  return json({ ok: true, channel, to: handle, delivery: result.queued ? "queued" : "duplicate" }, result.queued ? 202 : 200);
}
