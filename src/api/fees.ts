import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { venueFromPayload } from "@/lib/tenancy";
import {
  DEFAULT_FEE_SCHEDULE,
  INSTANT_PAYOUT_PERCENT,
  blendedRate,
  computeFee,
  feeTierFor,
  methodFromMetadata,
  type PayMethod,
} from "@/lib/fees";

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

// Fee transparency: the published per-method schedule + the real blended
// effective rate a merchant is actually paying, so a headline rate never hides
// the true cost across card mixes, wallets and instant payouts.
export async function handleFeesRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/fees")) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Public: the published schedule (drives the fee calculator + API consumers).
  if (path === "/api/fees/config" && request.method === "GET") {
    return json({
      schedule: DEFAULT_FEE_SCHEDULE,
      instantPayoutPercent: INSTANT_PAYOUT_PERCENT,
      currency: "KES",
    });
  }

  // Authed: the blended effective rate + per-method breakdown + daily takings.
  if (path === "/api/fees/summary" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);

    const days = Math.min(
      Math.max(Number(url.searchParams.get("days")) || 30, 1),
      365,
    );
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = (await sql`
        SELECT amount, fee_amount, metadata, created_at
        FROM payments
        WHERE venue_id = ${venue}
          AND status IN ('succeeded','paid','captured') AND kind != 'refund'
          AND created_at >= ${since}
        ORDER BY created_at DESC
        LIMIT 5000`) as Array<Record<string, unknown>>;
    } catch {
      rows = [];
    }

    const byMethod = new Map<
      PayMethod,
      { volume: number; fees: number; count: number }
    >();
    const dayMap = new Map<string, { gross: number; fees: number }>();
    const all: Array<{ amount: number; fee: number }> = [];

    for (const r of rows) {
      const amount = Number(r.amount) || 0;
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const method = methodFromMetadata(meta);
      // Prefer the stored fee; derive it for legacy rows recorded before fees
      // were tracked, so history isn't blank.
      const fee =
        r.fee_amount != null
          ? Number(r.fee_amount)
          : computeFee(amount, method).fee;
      all.push({ amount, fee });
      const m = byMethod.get(method) ?? { volume: 0, fees: 0, count: 0 };
      m.volume += amount;
      m.fees += fee;
      m.count += 1;
      byMethod.set(method, m);
      const day = String(r.created_at).slice(0, 10);
      const d = dayMap.get(day) ?? { gross: 0, fees: 0 };
      d.gross += amount;
      d.fees += fee;
      dayMap.set(day, d);
    }

    const totals = blendedRate(all);
    const methods = [...byMethod.entries()]
      .map(([method, v]) => ({
        method,
        label: feeTierFor(method).label,
        publishedPercent: feeTierFor(method).percent,
        volume: v.volume,
        fees: v.fees,
        count: v.count,
        rate: v.volume > 0 ? (v.fees / v.volume) * 100 : 0,
      }))
      .sort((a, b) => b.volume - a.volume);
    const daily = [...dayMap.entries()]
      .map(([date, v]) => ({
        date,
        gross: v.gross,
        fees: v.fees,
        net: v.gross - v.fees,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return json({
      days,
      currency: "KES",
      gross: totals.gross,
      fees: totals.fees,
      net: totals.net,
      effectiveRate: totals.rate,
      count: totals.count,
      methods,
      daily,
    });
  }

  return json({ error: "not found" }, 404);
}
