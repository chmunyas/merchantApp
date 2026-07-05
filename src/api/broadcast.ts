import { sendBroadcast, type BroadcastParams } from "@/lib/broadcast";
import { getSql } from "@/lib/db";
import { requireAuth, resolveVenue } from "@/api/auth";

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

export async function handleBroadcastRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/broadcast")) return null;

  const venue = await resolveVenue(request, env, url);

  if (path === "/api/broadcast" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as Partial<BroadcastParams>;
    if (!body.message?.trim()) return json({ error: "message required" }, 400);
    const result = await sendBroadcast(env, {
      venue,
      segment: body.segment ?? "all",
      channel: body.channel ?? "whatsapp",
      message: body.message,
    });
    return json(result);
  }

  if (path === "/api/broadcast/history" && request.method === "GET") {
    const sql = getSql(env);
    if (!sql) return json({ history: [] });
    const history = await sql`
      SELECT channel, status, count(*)::int AS count, max(created_at) AS last_at
      FROM events
      WHERE venue_id = ${venue} AND type = 'broadcast'
      GROUP BY channel, status
      ORDER BY max(created_at) DESC`;
    return json({ history });
  }

  return null;
}
