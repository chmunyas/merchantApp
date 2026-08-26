import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { planLimit, planLimitMessage, planOf, venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

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

// A server needs enough of the guest's number to recognise the right bill, and
// no more. Never return a full number to the floor.
function maskPhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (digits.length < 4) return null;
  return `•••${digits.slice(-3)}`;
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

  // B3.1 — a server searches a table and opens its payments so they can act on
  // the floor. This is payment data, not table data, so it is gated on
  // `payments:read` and NOT on `tables:read`. It stays at staff level (the same
  // level at which a server already receives live payment events) and is
  // deliberately narrow: one table, recent bills, redacted guest number, and no
  // provider references. Refunding is a separate, manager-only call.
  const paymentsMatch = url.pathname.match(
    /^\/api\/tables\/([0-9a-fA-F-]+)\/payments$/,
  );
  if (paymentsMatch && request.method === "GET") {
    if (
      !roleAtLeast(payload, "staff") ||
      !tokenHasScope(payload, "payments:read")
    ) {
      return json({ error: "forbidden" }, 403);
    }
    const tableVenue = venueFromPayload(payload, url);
    const tableSql = getSql(env);
    if (!tableSql) return json({ error: "database not configured" }, 503);
    const tableId = paymentsMatch[1];
    const [table] = await tableSql`
      SELECT id, label FROM dining_tables
      WHERE id = ${tableId} AND venue_id = ${tableVenue} LIMIT 1`;
    if (!table) return json({ error: "not found" }, 404);

    const rows = await tableSql`
      SELECT p.id, p.amount::bigint AS amount, p.tip_amount::bigint AS tip_amount,
             p.currency, p.status, p.created_at,
             p.metadata->>'order_id' AS order_id,
             p.metadata->>'customer_phone' AS customer_phone,
             o.status AS order_status,
             COALESCE((SELECT sum(r.amount) FROM payments r
                       WHERE r.kind = 'refund' AND r.status = 'refunded'
                         AND r.venue_id = ${tableVenue}
                         AND r.metadata->>'refund_of' = p.id), 0)::bigint AS refunded
      FROM payments p
      JOIN orders o ON o.id::text = p.metadata->>'order_id'
      WHERE p.venue_id = ${tableVenue}
        AND o.venue_id = ${tableVenue}
        AND o.table_id = ${tableId}
        AND p.kind <> 'refund'
      ORDER BY p.created_at DESC
      LIMIT 50`;

    // Manager+ is the refund boundary (POST /api/refunds). The floor sees the
    // truth about whether THEY can refund rather than a button that 403s.
    const canRefund =
      roleAtLeast(payload, "manager") && tokenHasScope(payload, "payments:write");
    return json({
      table: { id: String(table.id), label: String(table.label) },
      canRefund,
      payments: rows.map((row) => ({
        id: String(row.id),
        orderId: row.order_id ? String(row.order_id) : null,
        orderStatus: row.order_status ? String(row.order_status) : null,
        amount: Number(row.amount) / 100,
        tip: Number(row.tip_amount ?? 0) / 100,
        refunded: Number(row.refunded ?? 0) / 100,
        currency: String(row.currency ?? "KES"),
        status: String(row.status),
        customerPhone: maskPhone(row.customer_phone),
        createdAt: row.created_at,
      })),
    });
  }

  const write = request.method !== "GET";
  if (
    (write && !roleAtLeast(payload, "manager")) ||
    !tokenHasScope(payload, write ? "tables:write" : "tables:read")
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/tables" && request.method === "GET") {
    const tables = await sql`
      SELECT id, label, seats, section, active, revision, created_at, updated_at
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
    const plan = planOf(payload);
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM dining_tables WHERE venue_id = ${venue}`;
    if (Number(n) >= planLimit(plan, "tables")) {
      return json({ error: planLimitMessage(plan, "tables") }, 402);
    }
    const seats = Math.max(1, wholeNumber(body.seats ?? 2, 2));
    const section =
      body.section == null || String(body.section).trim() === ""
        ? null
        : String(body.section).trim();
    const [row] = await sql`
      INSERT INTO dining_tables (venue_id, label, seats, section)
      VALUES (${venue}, ${label}, ${seats}, ${section})
      RETURNING id, label, seats, section, active, revision, created_at, updated_at`;
    return json({ table: row }, 201);
  }

  const match = url.pathname.match(/^\/api\/tables\/([0-9a-fA-F-]+)$/);
  if (match) {
    const id = match[1];
    if (request.method === "DELETE") {
      const revision = Number(url.searchParams.get("revision"));
      if (!Number.isInteger(revision) || revision < 1) {
        return json({ error: "revision required" }, 428);
      }
      const deleted = await sql`
        DELETE FROM dining_tables
        WHERE id = ${id} AND venue_id = ${venue} AND revision = ${revision}
        RETURNING id`;
      if (deleted.length === 0) return json({ error: "table conflict" }, 409);
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        label?: string;
        seats?: number | string;
        section?: string | null;
        active?: boolean;
        revision?: number;
      };
      if (!Number.isInteger(body.revision) || Number(body.revision) < 1) {
        return json({ error: "revision required" }, 428);
      }
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
      const [updated] = await sql`
        UPDATE dining_tables SET
          label   = COALESCE(${label}, label),
          seats   = COALESCE(${seats}, seats),
          section = CASE WHEN ${body.section === undefined} THEN section ELSE ${section} END,
          active  = COALESCE(${body.active ?? null}, active),
          revision = revision + 1, updated_at = now()
        WHERE id = ${id} AND venue_id = ${venue}
          AND revision = ${Number(body.revision)}
        RETURNING id, label, seats, section, active, revision, created_at, updated_at`;
      if (!updated) return json({ error: "table conflict" }, 409);
      return json({ ok: true, table: updated });
    }
  }

  return null;
}
