import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// GET /api/venues — the venues the authed principal may act on (for the back-office
// venue picker). Scoped by principal so a merchant only sees their own venue, a
// reseller admin sees every venue under their org, and a platform admin sees all.
export async function handleVenuesRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/venues") return null;
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "GET") return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const role = typeof payload.role === "string" ? payload.role : "";
  const orgId = typeof payload.org === "string" ? payload.org : null;
  const venue = typeof payload.venue === "string" ? payload.venue : null;

  let rows: Array<Record<string, unknown>> = [];
  if (role === "admin") {
    rows = await sql`
      SELECT id, name, code, active FROM venues
      WHERE active = true ORDER BY name LIMIT 500`;
  } else if (orgId) {
    rows = await sql`
      SELECT id, name, code, active FROM venues
      WHERE org_id = ${orgId} AND active = true ORDER BY name LIMIT 500`;
  } else if (venue) {
    rows = await sql`
      SELECT id, name, code, active FROM venues WHERE id = ${venue} LIMIT 1`;
  }

  return json({
    venues: rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      active: row.active !== false,
    })),
  });
}
