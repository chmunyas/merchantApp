import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { requireAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";
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

function serializeDispute(row: Record<string, unknown>) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    amount: Number(row.amount ?? 0),
    currency: row.currency,
    status: row.status,
    reason: row.reason ?? null,
    connectorDisputeId: row.connector_dispute_id ?? null,
    evidenceDueBy: row.evidence_due_by ?? null,
    evidence: row.evidence ?? null,
    evidenceSubmittedAt: row.evidence_submitted_at ?? null,
    resolution: row.resolution ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


// Disputes / chargebacks + the payment webhook-event audit trail. Both are
// venue-scoped reads (gated) — the write path is the trusted webhook in
// `api/payments.ts` (recordDispute / recordPaymentEvent).
export async function handleDisputeRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/disputes" && !path.startsWith("/api/disputes/") &&
      path !== "/api/payment-events") {
    return null;
  }
  if (request.method === "OPTIONS") return json({ ok: true });

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const write = request.method !== "GET";
  if (
    !roleAtLeast(payload, "manager") ||
    !tokenHasScope(payload, write ? "payments:write" : "payments:read")
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // Audit trail for a payment (or the venue) — the incoming webhook timeline.
  if (path === "/api/payment-events" && request.method === "GET") {
    const paymentId = url.searchParams.get("payment_id");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const rows = paymentId
      ? await sql`
          SELECT id, payment_id, event_type, status, amount, currency, received_at
          FROM payment_events
          WHERE venue_id = ${venue} AND payment_id = ${paymentId}
          ORDER BY received_at DESC LIMIT ${limit}`
      : await sql`
          SELECT id, payment_id, event_type, status, amount, currency, received_at
          FROM payment_events
          WHERE venue_id = ${venue}
          ORDER BY received_at DESC LIMIT ${limit}`;
    return json({
      events: rows.map((r) => ({
        id: r.id,
        paymentId: r.payment_id,
        eventType: r.event_type,
        status: r.status,
        amount: Number(r.amount ?? 0),
        currency: r.currency,
        receivedAt: r.received_at,
      })),
    });
  }

  if (path === "/api/disputes" && request.method === "GET") {
    const status = url.searchParams.get("status");
    const rows = status
      ? await sql`
          SELECT id, payment_id, amount, currency, status, reason,
                 connector_dispute_id, evidence_due_by, evidence,
                 evidence_submitted_at, resolution, created_at, updated_at
          FROM disputes WHERE venue_id = ${venue} AND status = ${status}
          ORDER BY created_at DESC LIMIT 200`
      : await sql`
          SELECT id, payment_id, amount, currency, status, reason,
                 connector_dispute_id, evidence_due_by, evidence,
                 evidence_submitted_at, resolution, created_at, updated_at
          FROM disputes WHERE venue_id = ${venue}
          ORDER BY created_at DESC LIMIT 200`;
    const [counts] = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status IN ('open','under_review'))::int AS open,
             coalesce(sum(amount) FILTER (WHERE status IN ('open','under_review')), 0)::bigint AS open_amount
      FROM disputes WHERE venue_id = ${venue}`;
    return json({
      disputes: rows.map(serializeDispute),
      summary: {
        total: Number(counts?.total ?? 0),
        open: Number(counts?.open ?? 0),
        openAmount: Number(counts?.open_amount ?? 0),
      },
    });
  }

  const idMatch = path.match(/^\/api\/disputes\/([^/]+)$/);
  if (idMatch && request.method === "GET") {
    const [row] = await sql`
      SELECT id, payment_id, amount, currency, status, reason,
             connector_dispute_id, evidence_due_by, evidence,
             evidence_submitted_at, resolution, created_at, updated_at
      FROM disputes WHERE venue_id = ${venue} AND id = ${idMatch[1]} LIMIT 1`;
    if (!row) return json({ error: "not found" }, 404);
    return json({ dispute: serializeDispute(row) });
  }

  // --- Response tooling (contest / concede a chargeback) — money action, so
  // gated manager+. The provider submission itself runs when a PesaSwap key is
  // configured; either way the merchant's response + outcome are recorded here so
  // the dispute timeline is auditable and the agent/dashboard can act on it.
  const evidenceMatch = path.match(/^\/api\/disputes\/([^/]+)\/evidence$/);
  if (evidenceMatch && request.method === "POST") {
    if (!roleAtLeast(payload, "manager")) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { evidence?: string };
    const evidence = String(body.evidence ?? "").trim();
    if (!evidence) return json({ error: "evidence required" }, 400);
    const [row] = await sql`
      UPDATE disputes
      SET evidence = ${evidence},
          evidence_submitted_at = now(),
          status = CASE WHEN status IN ('open') THEN 'under_review' ELSE status END,
          updated_at = now()
      WHERE venue_id = ${venue} AND id = ${evidenceMatch[1]}
      RETURNING id, payment_id, amount, currency, status, reason,
                connector_dispute_id, evidence_due_by, evidence,
                evidence_submitted_at, resolution, created_at, updated_at`;
    if (!row) return json({ error: "not found" }, 404);
    return json({ dispute: serializeDispute(row) });
  }

  const acceptMatch = path.match(/^\/api\/disputes\/([^/]+)\/accept$/);
  if (acceptMatch && request.method === "POST") {
    if (!roleAtLeast(payload, "manager")) {
      return json({ error: "forbidden" }, 403);
    }
    const [row] = await sql`
      UPDATE disputes
      SET status = 'accepted', resolution = 'accepted', updated_at = now()
      WHERE venue_id = ${venue} AND id = ${acceptMatch[1]}
      RETURNING id, payment_id, amount, currency, status, reason,
                connector_dispute_id, evidence_due_by, evidence,
                evidence_submitted_at, resolution, created_at, updated_at`;
    if (!row) return json({ error: "not found" }, 404);
    return json({ dispute: serializeDispute(row) });
  }

  return null;
}
