import { sendBroadcast, type BroadcastParams } from "@/lib/broadcast";
import { getSql } from "@/lib/db";
import { enforceAccountRateLimit } from "@/lib/rate-limit";
import { requireAuth, resolveVenue } from "@/api/auth";
import { tokenHasScope } from "@/lib/api-tokens";
import { roleAtLeast } from "@/lib/rbac";
import { listChannels } from "@/lib/channels";

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
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "campaigns:write")) {
      return json({ error: "forbidden" }, 403);
    }
    // Per-account cap: a broadcast fans out to every contact in a segment, so
    // limit how many campaigns a single venue can fire per minute (independent
    // of IP). Prevents a runaway loop from spamming customers + burning quota.
    const limited = await enforceAccountRateLimit(env, venue, "broadcast", 6, 60);
    if (limited) return limited;
    const body = (await request.json()) as Partial<BroadcastParams>;
    if (!body.message?.trim()) return json({ error: "message required" }, 400);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) return json({ error: "Idempotency-Key header required" }, 400);
    const segment = body.segment ?? "all";
    const channel = body.channel ?? "whatsapp";
    if (!(["all", "gold_plus", "lapsed"] as string[]).includes(segment)) {
      return json({ error: "invalid segment" }, 400);
    }
    if (!listChannels().includes(channel)) return json({ error: "invalid channel" }, 400);
    const result = await sendBroadcast(env, {
      venue,
      segment,
      channel,
      message: body.message,
      idempotencyKey,
      createdBy: String(payload.sub ?? "operator"),
      templateId: body.templateId ?? null,
    });
    return json(result, result.duplicate ? 200 : 202);
  }

  if (path === "/api/broadcast/history" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "campaigns:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const sql = getSql(env);
    if (!sql) return json({ history: [] });
    const history = await sql`
      SELECT channel, status, count(*)::int AS count, max(created_at) AS last_at
      FROM outbound_deliveries
      WHERE venue_id = ${venue} AND source_type = 'broadcast'
      GROUP BY channel, status
      ORDER BY max(created_at) DESC`;
    return json({ history });
  }

  return null;
}
