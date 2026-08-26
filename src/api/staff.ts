import { getSql } from "@/lib/db";
import { requireHumanAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
import { hashStaffPin, isValidStaffPin, isWeakStaffPin } from "@/lib/staff-pin";
import { normalizeDestination } from "@/lib/otp";
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

  const payload = await requireHumanAuth(request, env);
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
    const rows = await sql`
      SELECT s.venue_id, v.name
      FROM staff s JOIN venues v ON v.id = s.venue_id
      WHERE s.id = ${staffId} AND s.venue_id = ${venue} AND s.active = true`;
    const venues = rows.map((r) => ({
      id: String(r.venue_id),
      name: (r.name as string) ?? "Store",
      current: String(r.venue_id) === venue,
    }));
    return json({ venues, current: venue });
  }

  if (url.pathname === "/api/staff" && request.method === "GET") {
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    const staff = await sql`
            SELECT id, name, role, phone, login_handle, active, created_at,
              credential_reset_required, credential_changed_at, pin_locked_until,
              (pin_hash IS NOT NULL) AS credential_configured
      FROM staff WHERE venue_id = ${venue} ORDER BY created_at`;
    return json({ staff });
  }

  if (url.pathname === "/api/staff" && request.method === "POST") {
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      role?: string;
      phone?: string;
      loginHandle?: string;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "name required" }, 400);
    const plan = planOf(payload);
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM staff WHERE venue_id = ${venue}`;
    if (Number(n) >= planLimit(plan, "staff")) {
      return json({ error: planLimitMessage(plan, "staff") }, 402);
    }
    const loginHandle = body.loginHandle
      ? normalizeDestination("sms", body.loginHandle)
      : body.phone
        ? normalizeDestination("sms", body.phone)
        : null;
    const [row] = await sql`
      INSERT INTO staff (venue_id, name, role, phone, login_handle)
      VALUES (${venue}, ${name}, ${body.role ?? "Server"}, ${body.phone ?? null}, ${loginHandle})
      RETURNING id, name, role, phone, login_handle, active, created_at,
                credential_reset_required, credential_changed_at,
                (pin_hash IS NOT NULL) AS credential_configured`;
    return json({ staff: row }, 201);
  }

  const pinResetMatch = url.pathname.match(
    /^\/api\/staff\/([0-9a-fA-F-]+)\/pin\/reset$/,
  );
  if (pinResetMatch && request.method === "POST") {
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      temporaryPin?: string;
    };
    const temporaryPin = String(body.temporaryPin ?? "").trim();
    if (!isValidStaffPin(temporaryPin)) {
      return json({ error: "Temporary PIN must contain 6 to 8 digits." }, 400);
    }
    if (isWeakStaffPin(temporaryPin)) {
      return json(
        {
          error:
            "That PIN is too easy to guess. Avoid repeated digits, runs like 123456, and repeating blocks.",
          code: "weak-pin",
        },
        400,
      );
    }
    const pinHash = await hashStaffPin(temporaryPin);
    const [row] = await sql`
      UPDATE staff
      SET pin_hash = ${pinHash},
          credential_version = credential_version + 1,
          credential_reset_required = false,
          credential_changed_at = now(),
          failed_pin_attempts = 0,
          pin_locked_until = NULL,
          pin = NULL
      WHERE id = ${pinResetMatch[1]} AND venue_id = ${venue}
      RETURNING id`;
    if (!row) return json({ error: "staff not found" }, 404);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...corsHeaders,
      },
    });
  }

  const match = url.pathname.match(/^\/api\/staff\/([0-9a-fA-F-]+)$/);
  if (match) {
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
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
        loginHandle?: string;
        active?: boolean;
      };
      const loginHandle =
        body.loginHandle === undefined
          ? null
          : normalizeDestination("sms", body.loginHandle);
      await sql`
        UPDATE staff SET
          name   = COALESCE(${body.name ?? null}, name),
          role   = COALESCE(${body.role ?? null}, role),
          phone  = COALESCE(${body.phone ?? null}, phone),
          login_handle = CASE
            WHEN ${body.loginHandle === undefined} THEN login_handle
            ELSE ${loginHandle}
          END,
          active = COALESCE(${body.active ?? null}, active)
        WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
  }

  return null;
}
