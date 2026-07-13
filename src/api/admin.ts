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

// Platform-admin views over REAL tenant data (not the local demo dataset the admin
// UI seeds). GET /api/admin/merchants lists every venue with its owner account and
// live payment activity, so the operator can actually see self-serve signups.
export async function handleAdminRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/merchants") return null;
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "GET") return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (payload.role !== "admin") return json({ error: "forbidden" }, 403);

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // One row per venue, joined to its owner app_user (if any) and its live payment
  // activity. user_venues.user_id ↔ app_users.id are both cast to text because the
  // columns can differ in type across the two auth tables.
  const rows = await sql`
    SELECT
      v.id,
      v.name         AS business_name,
      v.active,
      v.created_at,
      u.email        AS owner_email,
      u.name         AS owner_name,
      u.phone        AS owner_phone,
      u.plan         AS plan,
      COALESCE(s.tx_count, 0)   AS tx_count,
      COALESCE(s.tx_ok, 0)      AS tx_ok,
      COALESCE(s.gross_minor, 0) AS gross_minor,
      s.last_tx_at
    FROM venues v
    LEFT JOIN user_venues uv
      ON uv.venue_id = v.id AND uv.role = 'merchant'
    LEFT JOIN app_users u
      ON u.id::text = uv.user_id::text
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS tx_count,
        count(*) FILTER (WHERE status = 'succeeded')::int AS tx_ok,
        COALESCE(sum(amount) FILTER (WHERE status = 'succeeded'), 0)::bigint AS gross_minor,
        max(created_at) AS last_tx_at
      FROM payments p
      WHERE p.venue_id = v.id
    ) s ON true
    ORDER BY v.created_at DESC
    LIMIT 500`;

  const merchants = rows.map((r) => ({
    id: String(r.id),
    businessName: String(r.business_name ?? "Unnamed venue"),
    ownerName: r.owner_name ? String(r.owner_name) : "",
    ownerEmail: r.owner_email ? String(r.owner_email).toLowerCase() : "",
    phone: r.owner_phone ? String(r.owner_phone) : "",
    plan: r.plan ? String(r.plan) : "free",
    active: r.active !== false,
    onboardedAt: r.created_at
      ? new Date(r.created_at as string).toISOString()
      : new Date().toISOString(),
    txCount: Number(r.tx_count) || 0,
    txOk: Number(r.tx_ok) || 0,
    grossMinor: Number(r.gross_minor) || 0,
    lastTxAt: r.last_tx_at ? new Date(r.last_tx_at as string).toISOString() : null,
  }));

  return json({ merchants });
}
