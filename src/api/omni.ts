import { webHandle } from "@/lib/channels";
import { getSql } from "@/lib/db";
import { processInbound } from "@/lib/inbound";
import { requireAuth } from "@/api/auth";
import { roleAtLeast, venueFromPayload } from "@/lib/tenancy";
import { tokenHasScope } from "@/lib/api-tokens";

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

// The in-app web chat widget endpoints. The widget owns an anonymous session id
// (localStorage); every message runs the same agent pipeline as WhatsApp.
export async function handleOmniRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/chat") && path !== "/api/timeline") return null;

  if (path === "/api/chat" && request.method === "POST") {
    const body = (await request.json()) as {
      venue?: string;
      sessionId?: string;
      name?: string;
      text?: string;
    };
    if (!body.sessionId || !String(body.text ?? "").trim()) {
      return json({ error: "sessionId and text required" }, 400);
    }
    const result = await processInbound(
      {
        channel: "web",
        handle: webHandle(body.sessionId),
        platformUserId: body.sessionId,
        name: body.name?.trim() ? body.name.trim() : null,
        text: String(body.text),
        providerMsgId: null,
      },
      body.venue ?? "main",
      env,
    );
    return json(result);
  }

  if (path === "/api/chat/messages" && request.method === "GET") {
    const sql = getSql(env);
    if (!sql) return json({ messages: [] });
    const venue = url.searchParams.get("venue") ?? "main";
    const session = url.searchParams.get("session");
    if (!session) return json({ error: "session required" }, 400);
    const messages = await sql`
      SELECT m.id, m.direction, m.body, m.ai, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.venue_id = ${venue} AND c.channel = 'web'
        AND c.wa_id = ${webHandle(session)}
      ORDER BY m.created_at`;
    return json({ messages });
  }

  // Cross-channel timeline for a person (identity graph payoff): every message
  // to/from this human across WhatsApp, web, Telegram, IG and SMS, by phone.
  if (path === "/api/timeline" && request.method === "GET") {
    // A person's cross-channel history is PII, so this is staff-only and strictly
    // tenant-pinned: the caller must be authenticated and can only ever read their
    // OWN venue's data (the token's venue claim wins over any ?venue=).
    const payload = await requireAuth(request, env);
    if (!payload || !roleAtLeast(payload, "staff")) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!tokenHasScope(payload, "messaging:read") || !tokenHasScope(payload, "contacts:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const sql = getSql(env);
    if (!sql) return json({ messages: [] });
    const venue = venueFromPayload(payload, url);
    const phone = url.searchParams.get("phone");
    if (!phone) return json({ error: "phone required" }, 400);
    const messages = await sql`
      SELECT m.direction, m.body, m.channel, m.ai, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.venue_id = ${venue}
        AND (c.wa_id = ${phone}
             OR c.person_id = (
               SELECT id FROM persons
               WHERE venue_id = ${venue} AND primary_phone = ${phone} LIMIT 1))
      ORDER BY m.created_at DESC LIMIT 50`;
    const channels = Array.from(
      new Set(messages.map((m) => m.channel).filter(Boolean)),
    );
    return json({ messages, channels });
  }

  return null;
}
