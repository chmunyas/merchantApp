import { getSql } from "@/lib/db";
import { zReport, type ShiftPayment } from "@/lib/shifts";
import { venueFromPayload } from "@/lib/tenancy";
import { requireAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

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
  if (!tokenHasScope(payload, request.method === "GET" ? "shifts:read" : "shifts:write")) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/shifts/open" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      staffId?: string;
      staffName?: string;
      openingFloat?: number;
    };
    const ownStaffId = typeof payload.staff_id === "string"
      ? validUuid(payload.staff_id)
      : null;
    const requestedStaffId = validUuid(body.staffId);
    const staffId = roleAtLeast(payload, "manager")
      ? requestedStaffId ?? ownStaffId
      : ownStaffId;
    if (!staffId) return json({ error: "staff identity required" }, 400);
    const [staff] = await sql`
      SELECT id, name FROM staff
      WHERE id = ${staffId} AND venue_id = ${venue} AND active = true`;
    if (!staff) return json({ error: "active venue staff not found" }, 404);
    const [row] = await sql`
      INSERT INTO shifts (venue_id, staff_id, staff_name, opening_float)
      VALUES (${venue}, ${staffId}, ${staff.name}, ${toMinor(body.openingFloat)})
      RETURNING id, opened_at, opening_float`;
    return json({ ok: true, id: row.id, opened_at: row.opened_at }, 201);
  }

  if (url.pathname === "/api/shifts/current" && request.method === "GET") {
    const ownStaffId = typeof payload.staff_id === "string" ? payload.staff_id : null;
    const [shift] = await sql`
      SELECT id, staff_id, staff_name, opened_at, opening_float
      FROM shifts WHERE venue_id = ${venue} AND status = 'open'
        AND (${roleAtLeast(payload, "manager")} OR staff_id = ${ownStaffId}::uuid)
      ORDER BY opened_at DESC LIMIT 1`;
    if (!shift) return json({ shift: null, report: null });
    const payments = await sql`
      SELECT GREATEST(0, p.amount - COALESCE((SELECT sum(r.amount) FROM payments r
               WHERE r.kind='refund' AND r.status='refunded' AND r.metadata->>'refund_of'=p.id),0))::bigint AS amount,
             GREATEST(0, p.tip_amount - COALESCE((SELECT sum(fa.amount)
               FROM financial_adjustments fa WHERE fa.payment_id=p.id AND fa.component='tip'),0))::bigint AS tip_amount,
             p.staff_id, p.status FROM payments p
      WHERE venue_id = ${venue} AND created_at >= ${shift.opened_at}
        AND (${roleAtLeast(payload, "manager")} OR staff_id = ${ownStaffId}::uuid)
        AND currency = 'KES'
        AND kind <> 'refund'
        AND status IN ('succeeded','paid','captured','partially_refunded','refunded')`;
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
    const closedAt = new Date();
    const result = await sql.begin(async (tx) => {
      const [shift] = await tx`
        SELECT id, staff_id, opened_at, opening_float FROM shifts
        WHERE id = ${shiftId} AND venue_id = ${venue} AND status = 'open'
        FOR UPDATE`;
      if (!shift) return null;
      if (!roleAtLeast(payload, "manager") && String(shift.staff_id) !== String(payload.staff_id)) {
        return { forbidden: true } as const;
      }
      const payments = await tx`
      SELECT GREATEST(0, p.amount - COALESCE((SELECT sum(r.amount) FROM payments r
               WHERE r.kind='refund' AND r.status='refunded' AND r.metadata->>'refund_of'=p.id),0))::bigint AS amount,
             GREATEST(0, p.tip_amount - COALESCE((SELECT sum(fa.amount)
               FROM financial_adjustments fa WHERE fa.payment_id=p.id AND fa.component='tip'),0))::bigint AS tip_amount,
             p.staff_id, p.status FROM payments p
      WHERE venue_id = ${venue}
        AND currency = 'KES' AND kind <> 'refund'
        AND created_at >= ${shift.opened_at} AND created_at <= ${closedAt}
        AND status IN ('succeeded','paid','captured','partially_refunded','refunded')`;
      const cashSales = toMinor(body.cashSales);
      const cashCounted = body.cashCounted == null ? null : toMinor(body.cashCounted);
      const report = zReport({
        payments: payments as unknown as ShiftPayment[],
        openingFloat: Number(shift.opening_float),
        cashSales,
        cashCounted,
      });
      await tx`
        UPDATE shifts
        SET closed_at = ${closedAt}, cash_sales = ${cashSales},
            cash_counted = ${cashCounted}, status = 'closed',
            report = ${tx.json(report)}
        WHERE id = ${shift.id}`;
      return { report };
    });
    if (!result) return json({ error: "open shift not found" }, 404);
    if ("forbidden" in result) return json({ error: "forbidden" }, 403);
    return json({ ok: true, report: result.report });
  }

  if (url.pathname === "/api/shifts" && request.method === "GET") {
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    const shifts = await sql`
      SELECT id, staff_id, staff_name, opened_at, closed_at, opening_float,
             cash_sales, cash_counted, status, report
      FROM shifts WHERE venue_id = ${venue}
      ORDER BY opened_at DESC LIMIT 50`;
    return json({ shifts });
  }

  return null;
}
