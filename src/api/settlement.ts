import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";
import { sha256Hex } from "@/lib/hash";
import { postEntryInTransaction, settlementLines } from "@/lib/accounting";

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
    refunds: money(row.refunds),
    fee_credits: money(row.fee_credits),
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
  const write = request.method !== "GET";
  if (
    !roleAtLeast(payload, "manager") ||
    !tokenHasScope(payload, write ? "settlement:write" : "settlement:read")
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/settlement/evidence/import" && request.method === "POST") {
    if (!canRunSettlement(payload)) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => null)) as
      | {
          provider?: string;
          providerAccount?: string;
          sourceId?: string;
          payout?: {
            id?: string;
            status?: string;
            currency?: string;
            gross?: number;
            refunds?: number;
            fees?: number;
            feeCredits?: number;
            adjustments?: number;
            net?: number;
            bankReference?: string;
            occurredAt?: string;
          };
          lines?: Array<{
            type?: string;
            reference?: string;
            amount?: number;
            currency?: string;
            occurredAt?: string;
          }>;
        }
      | null;
    const provider = String(body?.provider ?? "pesaswap").trim().toLowerCase();
    const providerAccount = String(body?.providerAccount ?? "").trim();
    const sourceId = String(body?.sourceId ?? "").trim();
    const payout = body?.payout;
    const currency = String(payout?.currency ?? "KES").toUpperCase();
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    if (!providerAccount || !sourceId || !payout?.id || currency !== "KES") {
      return json({ error: "providerAccount, sourceId, KES payout id and totals are required" }, 400);
    }
    const allowedTypes = new Set(["capture","refund","fee","fee_credit","adjustment","transfer"]);
    if (lines.some((line) => !allowedTypes.has(String(line.type)) || !line.reference ||
        !Number.isSafeInteger(Number(line.amount)) || Number(line.amount) < 0 ||
        String(line.currency ?? "KES").toUpperCase() !== "KES")) {
      return json({ error: "invalid provider statement line" }, 400);
    }
    const totals = {
      gross: Number(payout.gross),
      refunds: Number(payout.refunds ?? 0),
      fees: Number(payout.fees ?? 0),
      feeCredits: Number(payout.feeCredits ?? 0),
      adjustments: Number(payout.adjustments ?? 0),
      net: Number(payout.net),
    };
    if (Object.values(totals).some((value) => !Number.isSafeInteger(value))) {
      return json({ error: "payout totals must be safe minor-unit integers" }, 400);
    }
    const expectedNet = totals.gross - totals.refunds - totals.fees +
      totals.feeCredits + totals.adjustments;
    if (expectedNet !== totals.net) return json({ error: "payout equation does not balance" }, 409);
    if (lines.length === 0) return json({ error: "provider statement lines are required" }, 400);
    const lineSum = (type: string) => lines
      .filter((line) => line.type === type)
      .reduce((sum, line) => sum + Number(line.amount), 0);
    const headerMatchesLines =
      lineSum("capture") === totals.gross &&
      lineSum("refund") === totals.refunds &&
      lineSum("fee") === totals.fees &&
      lineSum("fee_credit") === totals.feeCredits &&
      lineSum("adjustment") === totals.adjustments &&
      lineSum("transfer") === totals.net;
    if (!headerMatchesLines) return json({ error: "payout header and statement lines disagree" }, 409);
    const canonical = JSON.stringify({ provider, providerAccount, sourceId, payout, lines });
    const hash = await sha256Hex(canonical);
    try {
      const result = await sql.begin(async (tx) => {
        const [existing] = await tx`
          SELECT id, content_hash FROM provider_evidence_imports
          WHERE venue_id = ${venue} AND provider = ${provider}
            AND provider_account = ${providerAccount} AND source_id = ${sourceId}`;
        if (existing) {
          if (String(existing.content_hash) !== hash) throw new Error("evidence source conflict");
          return { replay: true, importId: String(existing.id) };
        }
        const [evidence] = await tx`
          INSERT INTO provider_evidence_imports
            (venue_id, provider, provider_account, source_id, content_hash,
             raw_evidence, imported_by)
          VALUES (${venue}, ${provider}, ${providerAccount}, ${sourceId}, ${hash},
                  ${tx.json(JSON.parse(canonical))}, ${String(payload.sub ?? "manager")})
          RETURNING id`;
        const [createdPayout] = await tx`
          INSERT INTO provider_payouts
            (evidence_import_id, venue_id, provider, external_id, currency, status,
             gross, refunds, fees, fee_credits, adjustments, net, bank_reference, occurred_at)
          VALUES (${evidence.id}, ${venue}, ${provider}, ${String(payout.id)}, ${currency},
                  ${String(payout.status ?? "pending")}, ${totals.gross}, ${totals.refunds},
                  ${totals.fees}, ${totals.feeCredits}, ${totals.adjustments}, ${totals.net},
                  ${payout.bankReference || null}, ${payout.occurredAt || null})
          RETURNING id`;
        for (const line of lines) {
          const lineType = String(line.type);
          const lineReference = String(line.reference);
          const lineAmount = Number(line.amount);
          const lineOccurredAt = line.occurredAt || null;
          await tx`
            INSERT INTO provider_settlement_lines
              (payout_id, venue_id, line_type, provider_reference, amount,
               currency, occurred_at)
                VALUES (${createdPayout.id}, ${venue}, ${lineType}, ${lineReference},
                  ${lineAmount}, 'KES', ${lineOccurredAt})`;
        }
        return { replay: false, importId: String(evidence.id), payoutId: String(createdPayout.id) };
      });
      return json(result, result.replay ? 200 : 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "evidence import failed" }, 409);
    }
  }

  if (url.pathname === "/api/settlement/reconcile" && request.method === "POST") {
    if (!canRunSettlement(payload)) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as { payoutId?: string };
    if (!body.payoutId || !validUuid(body.payoutId)) return json({ error: "valid payoutId required" }, 400);
    const payoutId = body.payoutId;
    const result = await sql.begin(async (tx) => {
      const [payout] = await tx`
        SELECT id, gross, refunds, fees, fee_credits, adjustments, net, status
        FROM provider_payouts WHERE id = ${payoutId}::uuid AND venue_id = ${venue}`;
      if (!payout) return null;
      const lines = await tx`
        SELECT id, line_type, provider_reference, amount FROM provider_settlement_lines
        WHERE payout_id = ${payout.id} AND line_type IN ('capture','refund')`;
      let matched = 0;
      let exceptions = 0;
      for (const line of lines) {
        const [local] = await tx`
          SELECT id, amount, kind FROM payments
          WHERE venue_id = ${venue} AND currency = 'KES'
            AND (id = ${line.provider_reference} OR provider_ref = ${line.provider_reference})
            AND status IN ('succeeded','paid','captured','partially_refunded','refunded')
          LIMIT 1`;
        const expectedKind = line.line_type === "refund" ? "refund" : "payment";
        if (!local || String(local.kind ?? "payment") !== expectedKind ||
            Number(local.amount) !== Number(line.amount)) {
          exceptions += 1;
          continue;
        }
        await tx`
          INSERT INTO reconciliation_matches
            (venue_id, provider_line_id, local_type, local_id, amount, matched_by)
          VALUES (${venue}, ${line.id}, ${expectedKind}, ${local.id}, ${line.amount},
                  ${String(payload.sub ?? "manager")})
          ON CONFLICT (provider_line_id, local_type, local_id) DO NOTHING`;
        matched += 1;
      }
      const [lineTotals] = await tx`
        SELECT
          COALESCE(sum(amount) FILTER (WHERE line_type='capture'),0)::bigint AS gross,
          COALESCE(sum(amount) FILTER (WHERE line_type='refund'),0)::bigint AS refunds,
          COALESCE(sum(amount) FILTER (WHERE line_type='fee'),0)::bigint AS fees,
          COALESCE(sum(amount) FILTER (WHERE line_type='fee_credit'),0)::bigint AS fee_credits,
          COALESCE(sum(CASE WHEN line_type='adjustment' THEN amount ELSE 0 END),0)::bigint AS adjustments,
          COALESCE(sum(amount) FILTER (WHERE line_type='transfer'),0)::bigint AS transfer
        FROM provider_settlement_lines WHERE payout_id = ${payout.id}`;
      const difference = Number(lineTotals.gross) - Number(lineTotals.refunds) -
        Number(lineTotals.fees) + Number(lineTotals.fee_credits) +
        Number(lineTotals.adjustments) - Number(lineTotals.transfer);
      const headerDifference = Number(lineTotals.gross) - Number(payout.gross) +
        (Number(payout.refunds) - Number(lineTotals.refunds)) +
        (Number(payout.fees) - Number(lineTotals.fees)) +
        (Number(lineTotals.fee_credits) - Number(payout.fee_credits)) +
        (Number(lineTotals.adjustments) - Number(payout.adjustments));
      const reconciled = String(payout.status) === "paid" && exceptions === 0 &&
        difference === 0 && headerDifference === 0 && matched === lines.length;
      if (reconciled) {
        await postEntryInTransaction(tx, {
          venue,
          sourceType: "provider_payout",
          sourceId: String(payout.id),
          currency: "KES",
          memo: `Provider payout ${payout.id}`,
          lines: settlementLines(Number(payout.gross) - Number(payout.refunds), Number(payout.fees) - Number(payout.fee_credits)),
        });
      }
      return {
        payoutId: String(payout.id), matched, exceptions, difference,
        headerDifference,
        reconciled,
      };
    });
    if (!result) return json({ error: "payout not found" }, 404);
    return json(result);
  }

  if (url.pathname === "/api/settlement/summary" && request.method === "GET") {
    const currency = String(url.searchParams.get("currency") ?? "KES").toUpperCase();
    if (currency !== "KES") return json({ error: "Only KES settlement estimates are supported." }, 409);
    const to = parseDate(url.searchParams.get("to"), isoDate(new Date()));
    const from = parseDate(
      url.searchParams.get("from"),
      isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );

    const [row] = await sql`
      SELECT count(*) FILTER (WHERE p.kind <> 'refund')::int AS tx_count,
             coalesce(sum(p.amount) FILTER (WHERE p.kind <> 'refund'), 0)::bigint AS gross,
             coalesce(sum(p.amount) FILTER (WHERE p.kind = 'refund' AND p.status = 'refunded'), 0)::bigint AS refunds,
             coalesce(sum(p.amount) FILTER (WHERE p.kind <> 'refund' AND p.settlement_id IS NOT NULL), 0)::bigint AS batched,
             coalesce(sum(p.amount) FILTER (WHERE p.kind <> 'refund' AND p.settlement_id IS NULL), 0)::bigint AS unbatched,
             count(*) FILTER (WHERE p.kind <> 'refund' AND p.initiator = 'agent')::int AS agent_count,
             coalesce(sum(p.amount) FILTER (WHERE p.kind <> 'refund' AND p.initiator = 'agent'), 0)::bigint AS agent_gross,
             count(*) FILTER (WHERE p.kind <> 'refund' AND p.initiator <> 'agent')::int AS human_count,
             coalesce(sum(p.amount) FILTER (WHERE p.kind <> 'refund' AND p.initiator <> 'agent'), 0)::bigint AS human_gross,
             coalesce((SELECT sum(sa.amount - COALESCE(ap.applied, 0))
                       FROM settlement_adjustments sa
                       LEFT JOIN (
                         SELECT adjustment_id, sum(amount)::bigint AS applied
                         FROM settlement_adjustment_applications GROUP BY adjustment_id
                       ) ap ON ap.adjustment_id = sa.id
                       WHERE sa.venue_id = ${venue}), 0)::bigint AS pending_adjustments
      FROM payments p
      WHERE p.venue_id = ${venue}
        AND p.currency = ${currency}
        AND p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
        AND created_at::date BETWEEN ${from} AND ${to}`;
    const gross = money(row?.gross);
    const refunds = money(row?.refunds);
    const fees = feesFor(gross);

    return json({
      from,
      to,
      currency,
      gross,
      refunds,
      fees,
      net: gross - refunds - fees,
      txCount: Number(row?.tx_count ?? 0),
      batchedEstimate: money(row?.batched),
      unbatchedEstimate: money(row?.unbatched),
      reconciled: money(row?.batched),
      unreconciled: money(row?.unbatched),
      pendingAdjustments: money(row?.pending_adjustments),
      reconciliationBasis: "internal-estimate",
      byInitiator: {
        agent: {
          count: Number(row?.agent_count ?? 0),
          gross: money(row?.agent_gross),
        },
        human: {
          count: Number(row?.human_count ?? 0),
          gross: money(row?.human_gross),
        },
      },
    });
  }

  const idMatch = url.pathname.match(/^\/api\/settlement\/([^/]+)$/);
  if (idMatch && request.method === "GET") {
    const id = idMatch[1];
    if (!validUuid(id)) return json({ error: "invalid settlement id" }, 400);
    const [batch] = await sql`
            SELECT id, venue_id, period_start, period_end, gross, fees, net, tx_count,
              status, refunds, fee_credits, created_at
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
            SELECT id, venue_id, period_start, period_end, gross, fees, net, tx_count,
              status, refunds, fee_credits, created_at
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
        SELECT p.id, p.amount,
               GREATEST(0, p.amount - COALESCE((
                 SELECT sum(r.amount) FROM payments r
                 WHERE r.venue_id = p.venue_id AND r.kind = 'refund'
                   AND r.status = 'refunded' AND r.metadata->>'refund_of' = p.id
               ), 0))::bigint AS net_amount
        FROM payments p
        WHERE p.venue_id = ${venue}
          AND p.settlement_id IS NULL
          AND p.currency = 'KES'
          AND p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
          AND p.kind <> 'refund'
          AND p.created_at::date BETWEEN ${from} AND ${to}
        ORDER BY p.created_at
        FOR UPDATE OF p`;
      const ids = payments.map((payment) => String(payment.id));
      const gross = payments.reduce(
        (sum, payment) => sum + money(payment.amount),
        0,
      );
      const refunds = payments.reduce(
        (sum, payment) => sum + Math.max(0, money(payment.amount) - money(payment.net_amount)),
        0,
      );
      const collectible = gross - refunds;
      if (ids.length === 0 || collectible <= 0) return null;
      const fees = feesFor(collectible);
      const [created] = await tx`
        INSERT INTO settlements
            (venue_id, period_start, period_end, gross, refunds, fees, net,
             tx_count, status, currency, basis)
          VALUES (${venue}, ${from}, ${to}, ${gross}, ${refunds}, ${fees},
            ${collectible - fees}, ${ids.length}, 'estimated', 'KES',
            'internal_estimate')
        RETURNING id, venue_id, period_start, period_end, gross, fees, net,
                  tx_count, status, refunds, fee_credits, created_at`;
      if (ids.length > 0) {
        await tx`
          UPDATE payments
          SET settlement_id = ${created.id}
          WHERE venue_id = ${venue}
            AND id IN (SELECT unnest(${ids}::text[]))`;
      }
      return serializeBatch(created);
    });

    if (!batch) return json({ error: "no unbatched payments" }, 409);

    return json({ batch }, 201);
  }

  return null;
}
