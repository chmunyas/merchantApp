import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { scoreCustomers, type CustomerStat } from "@/lib/rfm";
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

// Customer RFM segmentation + churn/LTV, computed from the payments ledger (the
// authoritative source of spend), joined to contacts for name/tier. Customers are
// keyed on metadata.customer_phone — the same loyalty key recordLedger accrues on.
export async function handleRfmRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/customers/rfm") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET") return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "manager")) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const rows = await sql`
    SELECT p.phone AS ref,
           COALESCE(c.name, 'Guest') AS name,
           COALESCE(c.tier, 'Bronze') AS tier,
           count(*)::int AS frequency,
           sum(p.amount)::bigint AS monetary_minor,
           EXTRACT(EPOCH FROM (now() - max(p.created_at))) / 86400 AS recency_days,
           EXTRACT(EPOCH FROM (now() - min(p.created_at))) / 86400 AS tenure_days
    FROM (
      SELECT NULLIF(metadata->>'customer_phone', '') AS phone, amount, created_at
      FROM payments
      WHERE venue_id = ${venue}
        AND status IN ('succeeded', 'paid', 'captured')
        AND kind <> 'refund'
    ) p
    LEFT JOIN contacts c ON c.venue_id = ${venue} AND c.phone = p.phone
    WHERE p.phone IS NOT NULL
    GROUP BY p.phone, c.name, c.tier
    ORDER BY monetary_minor DESC
    LIMIT 2000`;

  const stats: CustomerStat[] = rows.map((r) => ({
    ref: String(r.ref),
    name: String(r.name),
    tier: String(r.tier),
    recencyDays: Math.max(0, Math.round(Number(r.recency_days) || 0)),
    frequency: Number(r.frequency) || 0,
    monetary: Math.round(Number(r.monetary_minor) || 0) / 100,
    tenureDays: Math.max(0, Math.round(Number(r.tenure_days) || 0)),
  }));

  const result = scoreCustomers(stats);
  return json({
    generatedAt: new Date().toISOString(),
    currency: "KES",
    ...result,
  });
}
