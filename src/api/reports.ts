import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";

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
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/reports/summary" && request.method === "GET") {
    const to = parseDate(url.searchParams.get("to"), isoDate(new Date()));
    const from = parseDate(
      url.searchParams.get("from"),
      isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );

    const [totals] = await sql`
      SELECT count(*)::int AS tx,
             coalesce(sum(amount), 0)::bigint AS gross,
             coalesce(sum(tip_amount), 0)::bigint AS tips
      FROM payments
      WHERE venue_id = ${venue}
        AND status IN ('succeeded', 'paid', 'captured')
        AND created_at::date BETWEEN ${from} AND ${to}`;

    const byItem = await sql`
      SELECT oi.name,
             sum(oi.qty)::int AS qty,
             sum(oi.qty * oi.price)::bigint AS amount
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.venue_id = ${venue}
        AND o.created_at::date BETWEEN ${from} AND ${to}
      GROUP BY oi.name
      ORDER BY amount DESC`;

    const byDay = await sql`
      SELECT created_at::date AS day,
             count(*)::int AS tx,
             coalesce(sum(amount), 0)::bigint AS amount
      FROM payments
      WHERE venue_id = ${venue}
        AND status IN ('succeeded', 'paid', 'captured')
        AND created_at::date BETWEEN ${from} AND ${to}
      GROUP BY day
      ORDER BY day`;

    return json({
      from,
      to,
      currency: "KES",
      totals: {
        tx: Number(totals?.tx ?? 0),
        gross: Number(totals?.gross ?? 0),
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
