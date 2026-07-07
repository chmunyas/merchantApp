import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
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

// Merchant view of what payment methods customers have on file (M-Pesa numbers +
// tokenised cards/wallets), joined to the CRM contact for a name + tier. Gated
// manager+ — it exposes customer PII.
export async function handlePaymentMethodsAdminRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/payment-methods") return null;
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
    SELECT cpm.phone, cpm.kind, cpm.label, cpm.brand, cpm.last4, cpm.last_used_at,
           c.name, c.tier
    FROM customer_payment_methods cpm
    LEFT JOIN contacts c ON c.venue_id = ${venue} AND c.phone = cpm.phone
    WHERE cpm.venue_id = ${venue} OR c.id IS NOT NULL
    ORDER BY cpm.last_used_at DESC
    LIMIT 500`;

  const counts = { mpesa: 0, card: 0, wallet: 0 };
  for (const r of rows) {
    const k = String(r.kind);
    if (k === "mpesa" || k === "card" || k === "wallet") counts[k] += 1;
  }

  return json({
    methods: rows.map((r) => ({
      phone: String(r.phone),
      name: r.name ? String(r.name) : null,
      tier: r.tier ? String(r.tier) : null,
      kind: String(r.kind),
      label: String(r.label ?? ""),
      brand: r.brand ? String(r.brand) : null,
      last4: r.last4 ? String(r.last4) : null,
      lastUsedAt: r.last_used_at,
    })),
    counts,
    total: rows.length,
  });
}
