import { getSql } from "@/lib/db";
import { requireAuth, resolveVenue } from "@/api/auth";
import { tokenHasScope } from "@/lib/api-tokens";
import { roleAtLeast } from "@/lib/rbac";

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

// Dead-letter queue: failed durable deliveries. Retry only requeues work; the
// leased worker performs the provider call and preserves every attempt.
export async function handleDlqRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/dlq")) return null;

  if (path === "/api/dlq" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "messaging:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = await resolveVenue(request, env, url);
    const failed = await sql`
      SELECT id, channel, handle, source_type, last_error, attempts, created_at
      FROM outbound_deliveries
      WHERE venue_id = ${venue} AND status IN ('failed','unknown')
      ORDER BY created_at DESC LIMIT 50`;
    return json({ failed, count: failed.length });
  }

  if (path === "/api/dlq/retry" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "messaging:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : [];
    const rows = ids.length
      ? await sql`
          UPDATE outbound_deliveries
          SET status = 'queued', next_attempt_at = now(), retryable = true,
              claim_token = NULL, lease_expires_at = NULL
          WHERE venue_id = ${venue} AND id = ANY(${ids})
            AND status = 'failed'
          RETURNING id`
      : await sql`
          UPDATE outbound_deliveries
          SET status = 'queued', next_attempt_at = now(), retryable = true,
              claim_token = NULL, lease_expires_at = NULL
          WHERE id IN (
            SELECT id FROM outbound_deliveries
            WHERE venue_id = ${venue} AND status = 'failed'
            ORDER BY created_at DESC LIMIT 100
          ) RETURNING id`;
    return json({ requeued: rows.length }, 202);
  }

  return null;
}
