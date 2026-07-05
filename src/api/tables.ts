import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";

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

function wholeNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
}

// Server-authoritative dining tables, venue-scoped + authed. Per-row CRUD
// replaces the merchant_state tables blob (no whole-array clobber).
export async function handleTablesRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/tables")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/tables" && request.method === "GET") {
    const tables = await sql`
      SELECT id, label, seats, section, active, created_at
      FROM dining_tables
      WHERE venue_id = ${venue} AND active = true
      ORDER BY label`;
    return json({ tables });
  }

  if (url.pathname === "/api/tables" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      seats?: number | string;
      section?: string;
    };
    const label = String(body.label ?? "").trim();
    if (!label) return json({ error: "label required" }, 400);
    const seats = Math.max(1, wholeNumber(body.seats ?? 2, 2));
    const section =
      body.section == null || String(body.section).trim() === ""
        ? null
        : String(body.section).trim();
    const [row] = await sql`
      INSERT INTO dining_tables (venue_id, label, seats, section)
      VALUES (${venue}, ${label}, ${seats}, ${section})
      RETURNING id, label, seats, section, active, created_at`;
    return json({ table: row }, 201);
  }

  const match = url.pathname.match(/^\/api\/tables\/([0-9a-fA-F-]+)$/);
  if (match) {
    const id = match[1];
    if (request.method === "DELETE") {
      await sql`DELETE FROM dining_tables WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        label?: string;
        seats?: number | string;
        section?: string | null;
        active?: boolean;
      };
      const label =
        body.label == null ? null : String(body.label ?? "").trim();
      if (label === "") return json({ error: "label required" }, 400);
      const seats =
        body.seats == null
          ? null
          : Math.max(1, wholeNumber(body.seats, 2));
      const section =
        body.section == null
          ? null
          : String(body.section).trim() === ""
            ? null
            : String(body.section).trim();
      await sql`
        UPDATE dining_tables SET
          label   = COALESCE(${label}, label),
          seats   = COALESCE(${seats}, seats),
          section = CASE WHEN ${body.section === undefined} THEN section ELSE ${section} END,
          active  = COALESCE(${body.active ?? null}, active)
        WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
  }

  return null;
}
