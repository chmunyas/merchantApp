import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { planLimit, planLimitMessage, planOf, venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// Server-authoritative staff (team members), venue-scoped + authed. Per-row CRUD
// replaces the merchant_state 'settings.users' blob (no whole-array clobber).
export async function handleStaffRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/staff")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // The venues THIS staff member is assigned to (multi-venue). Per-venue staff
  // rows are linked by the staff member's phone, so one PIN login can see + switch
  // between every store they work at. Staff-accessible (any authed staff session).
  if (url.pathname === "/api/staff/my-venues" && request.method === "GET") {
    const staffId =
      typeof payload.staff_id === "string" ? payload.staff_id : null;
    if (!staffId) {
      // Non-staff (merchant/manager) session — report the current venue only.
      const [v] = await sql`SELECT id, name FROM venues WHERE id = ${venue} LIMIT 1`;
      return json({
        venues: v ? [{ id: String(v.id), name: v.name, current: true }] : [],
        current: venue,
      });
    }
    const [me] = await sql`SELECT phone FROM staff WHERE id = ${staffId} LIMIT 1`;
    const phone = me?.phone ? String(me.phone).trim() : "";
    const rows = phone
      ? await sql`
          SELECT s.venue_id, v.name
          FROM staff s JOIN venues v ON v.id = s.venue_id
          WHERE s.phone = ${phone} AND s.active = true
          ORDER BY v.name`
      : await sql`
          SELECT s.venue_id, v.name
          FROM staff s JOIN venues v ON v.id = s.venue_id
          WHERE s.id = ${staffId}`;
    const venues = rows.map((r) => ({
      id: String(r.venue_id),
      name: (r.name as string) ?? "Store",
      current: String(r.venue_id) === venue,
    }));
    return json({ venues, current: venue });
  }

  if (url.pathname === "/api/staff" && request.method === "GET") {
    const staff = await sql`
      SELECT id, name, role, phone, active, created_at
      FROM staff WHERE venue_id = ${venue} ORDER BY created_at`;
    return json({ staff });
  }

  if (url.pathname === "/api/staff" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      role?: string;
      phone?: string;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "name required" }, 400);
    const plan = planOf(payload);
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM staff WHERE venue_id = ${venue}`;
    if (Number(n) >= planLimit(plan, "staff")) {
      return json({ error: planLimitMessage(plan, "staff") }, 402);
    }
    const [row] = await sql`
      INSERT INTO staff (venue_id, name, role, phone)
      VALUES (${venue}, ${name}, ${body.role ?? "Server"}, ${body.phone ?? null})
      RETURNING id, name, role, phone, active, created_at`;
    return json({ staff: row }, 201);
  }

  const match = url.pathname.match(/^\/api\/staff\/([0-9a-fA-F-]+)$/);
  if (match) {
    const id = match[1];
    if (request.method === "DELETE") {
      await sql`DELETE FROM staff WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        role?: string;
        phone?: string;
        active?: boolean;
      };
      await sql`
        UPDATE staff SET
          name   = COALESCE(${body.name ?? null}, name),
          role   = COALESCE(${body.role ?? null}, role),
          phone  = COALESCE(${body.phone ?? null}, phone),
          active = COALESCE(${body.active ?? null}, active)
        WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
  }

  return null;
}
