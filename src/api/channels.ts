import { getAdapter } from "@/lib/channels";
import type { ChannelId } from "@/lib/channels/types";
import { processInbound } from "@/lib/inbound";
import { requireAuth } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// Read JSON or form-encoded (Africa's Talking SMS callbacks) into a plain object.
async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return request.json();
}

// Build a collision-free handle + identity id for a simulated inbound message.
function buildSimHandle(
  channel: ChannelId,
  from: string,
): { handle: string; uid: string } {
  switch (channel) {
    case "telegram":
      return { handle: `tg:${from}`, uid: `tg:${from}` };
    case "instagram":
      return { handle: `ig:${from}`, uid: `ig:${from}` };
    case "web":
      return { handle: `web:${from}`, uid: from };
    case "whatsapp":
    case "sms": {
      const phone = from.startsWith("+") ? from : `+${from}`;
      return { handle: phone, uid: phone };
    }
    default:
      return { handle: from, uid: from };
  }
}

function defaultFrom(channel: ChannelId): string {
  switch (channel) {
    case "telegram":
      return "555001";
    case "instagram":
      return "17900000001";
    case "web":
      return "sim-web";
    default:
      return "+254712345678";
  }
}

export async function handleChannelRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Multi-channel simulator — drive any channel's pipeline without credentials.
  if (path === "/api/channels/simulate" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      channel?: string;
      venue?: string;
      from?: string;
      name?: string;
      text?: string;
    };
    const channel = (body.channel ?? "web") as ChannelId;
    const from = body.from?.trim() ? body.from.trim() : defaultFrom(channel);
    const { handle, uid } = buildSimHandle(channel, from);
    const result = await processInbound(
      {
        channel,
        handle,
        platformUserId: uid,
        name: body.name?.trim() ? body.name.trim() : null,
        text: String(body.text ?? ""),
        providerMsgId: null,
      },
      body.venue ?? "main",
      env,
    );
    return json(result);
  }

  // Generic inbound webhook for Telegram / Instagram / SMS.
  // (WhatsApp keeps its dedicated /api/whatsapp/webhook route.)
  const match = path.match(/^\/api\/(telegram|instagram|sms)\/(webhook|inbound)$/);
  if (!match) return null;
  const channel = match[1] as ChannelId;
  const adapter = getAdapter(channel);

  if (request.method === "GET") {
    return adapter.verifyWebhook?.(url, env) ?? new Response("ok", { status: 200 });
  }

  if (request.method === "POST") {
    try {
      const body = await readBody(request);
      for (const message of adapter.parseInbound?.(body) ?? []) {
        await processInbound(message, "main", env);
      }
    } catch {
      // Always 200 so providers do not retry a malformed event.
    }
    return json({ received: true });
  }

  return null;
}
