import { getSql } from "@/lib/db";
import { requireHumanAuth } from "@/api/auth";
import { planLimit, planLimitMessage, planOf } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function serialize(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    active: row.active !== false,
    timezone: row.timezone ?? "Africa/Nairobi",
  }));
}

// /api/venues — the venues the authed principal may act on (multi-store picker).
// GET: a merchant sees every store they are a MEMBER of (user_venues), a reseller
// admin sees their org's venues, a platform admin sees all. POST: add a new store
// to the current account (plan-capped) and become its owner.
export async function handleVenuesRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/venues") return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const role = typeof payload.role === "string" ? payload.role : "";
  const orgId = typeof payload.org === "string" ? payload.org : null;
  const venue = typeof payload.venue === "string" ? payload.venue : null;
  const email = typeof payload.sub === "string" ? payload.sub.toLowerCase() : "";

  if (request.method === "GET") {
    let rows: Array<Record<string, unknown>> = [];
    if (role === "admin") {
      rows = await sql`
        SELECT id, name, code, active, timezone FROM venues
        WHERE active = true ORDER BY name LIMIT 500`;
    } else if (orgId) {
      rows = await sql`
        SELECT id, name, code, active, timezone FROM venues
        WHERE org_id = ${orgId} AND active = true ORDER BY name LIMIT 500`;
    } else if (email.includes("@")) {
      // Merchant: every store they own/manage (multi-store membership).
      rows = await sql`
        SELECT v.id, v.name, v.code, v.active, v.timezone
        FROM user_venues uv
        JOIN app_users u ON u.id = uv.user_id
        JOIN venues v ON v.id = uv.venue_id
        WHERE lower(u.email) = ${email}
        ORDER BY v.name LIMIT 200`;
    }
    // Fallback (staff/session tokens without a membership): the token's own venue.
    if (rows.length === 0 && venue) {
      rows = await sql`
        SELECT id, name, code, active, timezone FROM venues WHERE id = ${venue} LIMIT 1`;
    }
    return json({ venues: serialize(rows) });
  }

  if (request.method === "POST") {
    if (role !== "merchant" || !email.includes("@")) {
      return json({ error: "only a merchant account can add a store" }, 403);
    }
    const [user] = await sql`
      SELECT id, org_id FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
    if (!user) return json({ error: "account not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      timezone?: string;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "store name required" }, 400);
    const timezone = String(body.timezone ?? "Africa/Nairobi");
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      return json({ error: "invalid IANA timezone" }, 400);
    }

    // Plan cap on stores per account.
    const plan = planOf(payload);
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM user_venues WHERE user_id = ${user.id}`;
    if (Number(n) >= planLimit(plan, "stores")) {
      return json({ error: planLimitMessage(plan, "stores") }, 402);
    }

    const venueId = `v_${crypto.randomUUID().slice(0, 8)}`;
    const code =
      name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "VEN";
    await sql`
      INSERT INTO venues (id, name, code, active, org_id, timezone)
      VALUES (${venueId}, ${name}, ${code}, true, ${user.org_id ?? null}, ${timezone})`;
    await sql`
      INSERT INTO user_venues (user_id, venue_id, role)
      VALUES (${user.id}, ${venueId}, 'merchant')
      ON CONFLICT DO NOTHING`;
    return json({ venue: { id: venueId, name, code, active: true, timezone } }, 201);
  }

  return null;
}
