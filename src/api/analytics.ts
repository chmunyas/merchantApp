import { getSql } from "@/lib/db";
import { requireAuth, resolveVenue } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// Agent & channel analytics from the omnichannel event/message stores.
export async function handleAnalyticsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/analytics/agent") return null;
  if (request.method !== "GET") return null;

  if (!(await requireAuth(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  const byChannel = await sql`
    SELECT channel, count(*)::int AS conversations
    FROM conversations WHERE venue_id = ${venue}
    GROUP BY channel ORDER BY conversations DESC`;

  const [msg] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE m.direction = 'inbound')::int AS inbound,
      count(*) FILTER (WHERE m.direction = 'outbound' AND m.ai)::int AS ai_replies,
      count(*) FILTER (WHERE m.direction = 'outbound' AND NOT m.ai)::int AS human_replies
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.venue_id = ${venue}`;

  const tools = await sql`
    SELECT m.tool, count(*)::int AS count
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.venue_id = ${venue} AND m.tool IS NOT NULL
    GROUP BY m.tool ORDER BY count DESC`;

  const [conv] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'escalated')::int AS escalated
    FROM conversations WHERE venue_id = ${venue}`;

  const [broadcasts] = await sql`
    SELECT count(*)::int AS total
    FROM events WHERE venue_id = ${venue} AND type = 'broadcast'`;

  const escalationRate =
    conv.total > 0 ? Math.round((conv.escalated / conv.total) * 100) : 0;
  const automationRate =
    msg.ai_replies + msg.human_replies > 0
      ? Math.round(
          (msg.ai_replies / (msg.ai_replies + msg.human_replies)) * 100,
        )
      : 0;

  return json({
    byChannel,
    messages: msg,
    tools,
    conversations: conv,
    broadcasts: broadcasts.total,
    escalationRate,
    automationRate,
  });
}
