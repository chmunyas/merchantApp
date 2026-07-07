import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import {
  createPayLink,
  resolvePayLink,
  type PayLinkKind,
} from "@/lib/pay-links";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";

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

// Server-bound payment requests ("pay links"): mint a short, tokenised link for an
// arbitrary amount (Tap&Go / booking deposit / split / ad-hoc) so it can be sent
// over any channel WITHOUT trusting the amount from the URL.
export async function handlePayLinkRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/pay-links")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Public resolver for the /pay page — GET /api/pay-links/:token.
  const tokenMatch = path.match(/^\/api\/pay-links\/([A-Za-z0-9]+)$/);
  if (tokenMatch && request.method === "GET") {
    const resolved = (await resolvePayLink(env, tokenMatch[1])) as Record<
      string,
      unknown
    >;
    if (resolved.error) {
      return json(
        { error: resolved.error },
        Number(resolved.status) || 400,
      );
    }
    return json(resolved);
  }

  // Everything else is gated (staff+ can request payment from a customer).
  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "staff")) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);

  // Mint a pay link — POST /api/pay-links { amount(minor|whole?), description, ... }.
  if (path === "/api/pay-links" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      amount?: number; // MINOR units (cents)
      amountKes?: number; // OR whole KES (convenience) — converted ×100
      currency?: string;
      description?: string;
      kind?: string;
      reference?: string;
      phone?: string;
      name?: string;
      expiresInMinutes?: number;
    };
    const amountMinor =
      typeof body.amount === "number" && body.amount > 0
        ? Math.round(body.amount)
        : typeof body.amountKes === "number" && body.amountKes > 0
          ? Math.round(body.amountKes * 100)
          : 0;
    if (amountMinor <= 0) {
      return json({ error: "amount must be positive" }, 400);
    }
    const result = await createPayLink(env, venue, {
      amount: amountMinor,
      currency: body.currency,
      description: body.description ?? null,
      kind: (body.kind as PayLinkKind) ?? "request",
      reference: body.reference ?? null,
      phone: body.phone ?? null,
      name: body.name ?? null,
      createdBy:
        (payload.staff_id as string) || (payload.sub as string) || "staff",
      expiresInMinutes: body.expiresInMinutes ?? null,
    });
    if ("error" in result) return json({ error: result.error }, 400);
    return json(result, 201);
  }

  // List recent pay links for the venue (log / dashboard) — GET /api/pay-links.
  if (path === "/api/pay-links" && request.method === "GET") {
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const limit = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("limit")) || 30),
    );
    const rows = await sql`
      SELECT token, amount, currency, description, kind, reference, status,
             customer_phone, customer_name, payment_id, created_at, paid_at
      FROM pay_links
      WHERE venue_id = ${venue}
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    return json({
      payLinks: rows.map((r) => ({
        token: String(r.token),
        amount: Number(r.amount) || 0,
        currency: String(r.currency ?? "KES"),
        description: r.description ? String(r.description) : null,
        kind: String(r.kind ?? "request"),
        reference: r.reference ? String(r.reference) : null,
        status: String(r.status),
        customerPhone: r.customer_phone ? String(r.customer_phone) : null,
        customerName: r.customer_name ? String(r.customer_name) : null,
        paymentId: r.payment_id ? String(r.payment_id) : null,
        createdAt: r.created_at,
        paidAt: r.paid_at,
      })),
      total: rows.length,
    });
  }

  return null;
}
