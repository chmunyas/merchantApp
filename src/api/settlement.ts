import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Estimated merchant settlement fee rate until provider-specific pricing lands.
const FEE_RATE = 0.015;
const SETTLEMENT_ROLES = new Set(["manager", "merchant", "admin"]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function money(value: unknown): number {
  return Number(value ?? 0);
}

function feesFor(gross: number): number {
  return Math.round(gross * FEE_RATE);
}

function canRunSettlement(payload: Record<string, unknown>): boolean {
  const role = typeof payload.role === "string" ? payload.role : "";
  return SETTLEMENT_ROLES.has(role);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function serializeBatch(row: Record<string, unknown>) {
  return {
    id: row.id,
    venue_id: row.venue_id,
    period_start: row.period_start,
    period_end: row.period_end,
    gross: money(row.gross),
    fees: money(row.fees),
    net: money(row.net),
    tx_count: Number(row.tx_count ?? 0),
    status: row.status,
    created_at: row.created_at,
  };
}

export async function handleSettlementRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/settlement")) return null;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/settlement/summary" && request.method === "GET") {
    const to = parseDate(url.searchParams.get("to"), isoDate(new Date()));
    const from = parseDate(
      url.searchParams.get("from"),
      isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );

    const [row] = await sql`
      SELECT count(*)::int AS tx_count,
             coalesce(sum(amount), 0)::bigint AS gross,
             coalesce(sum(amount) FILTER (WHERE settlement_id IS NOT NULL), 0)::bigint AS reconciled,
             coalesce(sum(amount) FILTER (WHERE settlement_id IS NULL), 0)::bigint AS unreconciled
      FROM payments
      WHERE venue_id = ${venue}
        AND status IN ('succeeded', 'paid', 'captured')
        AND created_at::date BETWEEN ${from} AND ${to}`;
    const gross = money(row?.gross);
    const fees = feesFor(gross);

    return json({
      from,
      to,
      currency: "KES",
      gross,
      fees,
      net: gross - fees,
      txCount: Number(row?.tx_count ?? 0),
      reconciled: money(row?.reconciled),
      unreconciled: money(row?.unreconciled),
    });
  }

  const idMatch = url.pathname.match(/^\/api\/settlement\/([^/]+)$/);
  if (idMatch && request.method === "GET") {
    const id = idMatch[1];
    if (!validUuid(id)) return json({ error: "invalid settlement id" }, 400);
    const [batch] = await sql`
      SELECT id, venue_id, period_start, period_end, gross, fees, net, tx_count, status, created_at
      FROM settlements
      WHERE venue_id = ${venue} AND id = ${id}
      LIMIT 1`;
    if (!batch) return json({ error: "not found" }, 404);
    const payments = await sql`
      SELECT id, amount, status, created_at
      FROM payments
      WHERE venue_id = ${venue} AND settlement_id = ${id}
      ORDER BY created_at DESC`;
    return json({
      batch: serializeBatch(batch),
      payments: payments.map((payment) => ({
        id: payment.id,
        amount: money(payment.amount),
        status: payment.status,
        created_at: payment.created_at,
      })),
    });
  }

  if (url.pathname === "/api/settlement" && request.method === "GET") {
    const batches = await sql`
      SELECT id, venue_id, period_start, period_end, gross, fees, net, tx_count, status, created_at
      FROM settlements
      WHERE venue_id = ${venue}
      ORDER BY created_at DESC
      LIMIT 100`;
    return json({ batches: batches.map(serializeBatch) });
  }

  if (url.pathname === "/api/settlement/run" && request.method === "POST") {
    if (!canRunSettlement(payload)) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      from?: string;
      to?: string;
    };
    const to = parseDate(body.to, isoDate(new Date()));
    const from = parseDate(
      body.from,
      isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );

    const batch = await sql.begin(async (tx) => {
      const payments = await tx`
        SELECT id, amount
        FROM payments
        WHERE venue_id = ${venue}
          AND settlement_id IS NULL
          AND status IN ('succeeded', 'paid', 'captured')
          AND created_at::date BETWEEN ${from} AND ${to}
        ORDER BY created_at
        FOR UPDATE`;
      const ids = payments.map((payment) => String(payment.id));
      const gross = payments.reduce(
        (sum, payment) => sum + money(payment.amount),
        0,
      );
      const fees = feesFor(gross);
      const [created] = await tx`
        INSERT INTO settlements (venue_id, period_start, period_end, gross, fees, net, tx_count)
        VALUES (${venue}, ${from}, ${to}, ${gross}, ${fees}, ${gross - fees}, ${ids.length})
        RETURNING id, venue_id, period_start, period_end, gross, fees, net, tx_count, status, created_at`;
      if (ids.length > 0) {
        await tx`
          UPDATE payments
          SET settlement_id = ${created.id}
          WHERE venue_id = ${venue}
            AND id IN (SELECT unnest(${ids}::text[]))`;
      }
      return serializeBatch(created);
    });

    return json({ batch }, 201);
  }

  return null;
}
