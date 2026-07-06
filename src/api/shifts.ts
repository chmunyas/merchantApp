import { getSql } from "@/lib/db";
import { zReport, type ShiftPayment } from "@/lib/shifts";
import { venueFromPayload } from "@/lib/tenancy";
import { requireAuth } from "@/api/auth";

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

function validUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

// Cash figures come from the till in whole KES; the ledger is minor units.
const toMinor = (v: unknown) => Math.max(0, Math.round(Number(v) || 0)) * 100;

export async function handleShiftsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/shifts")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/shifts/open" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      staffId?: string;
      staffName?: string;
      openingFloat?: number;
    };
    const staffId =
      validUuid(body.staffId) ??
      (typeof payload.staff_id === "string" ? validUuid(payload.staff_id) : null);
    const [row] = await sql`
      INSERT INTO shifts (venue_id, staff_id, staff_name, opening_float)
      VALUES (${venue}, ${staffId}, ${body.staffName ?? null}, ${toMinor(body.openingFloat)})
      RETURNING id, opened_at, opening_float`;
    return json({ ok: true, id: row.id, opened_at: row.opened_at }, 201);
  }

  if (url.pathname === "/api/shifts/current" && request.method === "GET") {
    const [shift] = await sql`
      SELECT id, staff_id, staff_name, opened_at, opening_float
      FROM shifts WHERE venue_id = ${venue} AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1`;
    if (!shift) return json({ shift: null, report: null });
    const payments = await sql`
      SELECT amount, tip_amount, staff_id, status FROM payments
      WHERE venue_id = ${venue} AND created_at >= ${shift.opened_at}
        AND status IN ('succeeded','paid','captured')`;
    const report = zReport({
      payments: payments as unknown as ShiftPayment[],
      openingFloat: Number(shift.opening_float),
    });
    return json({ shift, report });
  }

  if (url.pathname === "/api/shifts/close" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      shiftId?: string;
      cashSales?: number;
      cashCounted?: number;
    };
    const shiftId = validUuid(body.shiftId);
    if (!shiftId) return json({ error: "shiftId required" }, 400);
    const [shift] = await sql`
      SELECT id, opened_at, opening_float FROM shifts
      WHERE id = ${shiftId} AND venue_id = ${venue} AND status = 'open'`;
    if (!shift) return json({ error: "open shift not found" }, 404);
    const closedAt = new Date();
    const payments = await sql`
      SELECT amount, tip_amount, staff_id, status FROM payments
      WHERE venue_id = ${venue}
        AND created_at >= ${shift.opened_at} AND created_at <= ${closedAt}
        AND status IN ('succeeded','paid','captured')`;
    const cashSales = toMinor(body.cashSales);
    const cashCounted =
      body.cashCounted == null ? null : toMinor(body.cashCounted);
    const report = zReport({
      payments: payments as unknown as ShiftPayment[],
      openingFloat: Number(shift.opening_float),
      cashSales,
      cashCounted,
    });
    await sql`
      UPDATE shifts
      SET closed_at = ${closedAt}, cash_sales = ${cashSales},
          cash_counted = ${cashCounted}, status = 'closed',
          report = ${sql.json(report)}
      WHERE id = ${shift.id}`;
    return json({ ok: true, report });
  }

  if (url.pathname === "/api/shifts" && request.method === "GET") {
    const shifts = await sql`
      SELECT id, staff_id, staff_name, opened_at, closed_at, opening_float,
             cash_sales, cash_counted, status, report
      FROM shifts WHERE venue_id = ${venue}
      ORDER BY opened_at DESC LIMIT 50`;
    return json({ shifts });
  }

  return null;
}
