import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string | null, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

// The merchant "notebook": a period sales report the owner can export. Aggregates
// totals + tips from the payments ledger and per-item quantities/amounts from
// orders. Authed + venue-pinned. No POS required — pure value-add on top of the
// tap-and-go payments.
export async function handleReportsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/reports")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "analytics:read")) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/reports/summary" && request.method === "GET") {
    const currency = String(url.searchParams.get("currency") ?? "KES").toUpperCase();
    if (currency !== "KES") return json({ error: "Only KES reports are supported." }, 409);
    const to = parseDate(url.searchParams.get("to"), isoDate(new Date()));
    const from = parseDate(
      url.searchParams.get("from"),
      isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );

    const [totals] = await sql`
      SELECT count(*) FILTER (WHERE p.kind <> 'refund')::int AS tx,
             coalesce(sum(p.amount) FILTER (WHERE p.kind <> 'refund'), 0)::bigint AS gross,
             coalesce(sum(p.amount) FILTER (WHERE p.kind = 'refund' AND p.status='refunded'), 0)::bigint AS refunds,
             coalesce(sum(CASE WHEN p.kind <> 'refund' THEN
               p.tip_amount - COALESCE((SELECT sum(fa.amount)
                 FROM financial_adjustments fa
                 WHERE fa.payment_id = p.id AND fa.component = 'tip'), 0)
               ELSE 0 END), 0)::bigint AS tips
      FROM payments p
      WHERE p.venue_id = ${venue}
        AND p.currency = ${currency}
        AND p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
        AND p.created_at::date BETWEEN ${from} AND ${to}`;

    const byItem = await sql`
      SELECT oi.name,
             sum(oi.qty)::int AS qty,
             sum(oi.qty * oi.price)::bigint AS amount
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.venue_id = ${venue}
        AND o.currency = ${currency}
        AND o.paid_at IS NOT NULL AND o.status <> 'cancelled'
        AND o.created_at::date BETWEEN ${from} AND ${to}
      GROUP BY oi.name
      ORDER BY amount DESC`;

    const byDay = await sql`
      SELECT created_at::date AS day,
             count(*)::int AS tx,
             coalesce(sum(amount), 0)::bigint AS amount
      FROM payments
      WHERE venue_id = ${venue}
        AND currency = ${currency}
        AND kind <> 'refund'
        AND status IN ('succeeded','paid','captured','partially_refunded','refunded')
        AND created_at::date BETWEEN ${from} AND ${to}
      GROUP BY day
      ORDER BY day`;

    return json({
      from,
      to,
      currency,
      totals: {
        tx: Number(totals?.tx ?? 0),
        gross: Number(totals?.gross ?? 0),
        refunds: Number(totals?.refunds ?? 0),
        net: Number(totals?.gross ?? 0) - Number(totals?.refunds ?? 0),
        tips: Number(totals?.tips ?? 0),
      },
      byItem: byItem.map((r) => ({
        name: r.name,
        qty: Number(r.qty),
        amount: Number(r.amount),
      })),
      byDay: byDay.map((r) => ({
        day: r.day,
        tx: Number(r.tx),
        amount: Number(r.amount),
      })),
    });
  }

  return null;
}
