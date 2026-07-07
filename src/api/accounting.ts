import { requireAuth } from "@/api/auth";
import {
  CHART,
  arAging,
  auditEntries,
  balanceSheet,
  closePeriod,
  generalLedger,
  incomeStatement,
  journalList,
  listPeriods,
  lostBasket,
  postEntry,
  reopenPeriod,
  trialBalance,
} from "@/lib/accounting";
import { getSql } from "@/lib/db";
import { sha256Hex } from "@/lib/hash";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const POST_ROLES = new Set(["manager", "merchant", "admin"]);
const VALID_CODES = new Set(CHART.map((a) => a.code));

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

export async function handleAccountingRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/accounting")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const to = parseDate(url.searchParams.get("to"), isoDate(new Date()));
  const from = parseDate(
    url.searchParams.get("from"),
    isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  );

  if (path === "/api/accounting/chart" && request.method === "GET") {
    return json({ accounts: CHART });
  }

  if (path === "/api/accounting/trial-balance" && request.method === "GET") {
    return json(await trialBalance(sql, venue, from, to));
  }

  if (path === "/api/accounting/income-statement" && request.method === "GET") {
    return json({ from, to, ...(await incomeStatement(sql, venue, from, to)) });
  }

  if (path === "/api/accounting/balance-sheet" && request.method === "GET") {
    const asOf = parseDate(url.searchParams.get("asOf"), to);
    return json({ asOf, ...(await balanceSheet(sql, venue, asOf)) });
  }

  if (path === "/api/accounting/journal" && request.method === "GET") {
    const limit = Math.min(
      500,
      Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200),
    );
    return json({ entries: await journalList(sql, venue, from, to, limit) });
  }

  // Tamper-evident audit export: each entry carries a content hash, and every
  // entry is chained to the previous one (chainHash = SHA-256(prevHash +
  // contentHash)). Altering, inserting, deleting or reordering any entry breaks
  // the chain, so `finalHash` anchors the integrity of the whole period.
  if (path === "/api/accounting/audit" && request.method === "GET") {
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!POST_ROLES.has(role)) return json({ error: "forbidden" }, 403);
    const rows = (await auditEntries(sql, venue, from, to)) as unknown as Array<{
      id: string;
      entry_date: string;
      memo: string | null;
      source_type: string | null;
      source_id: string | null;
      currency: string | null;
      amount: string | number | null;
      lines: Array<{
        account: string;
        debit: number | string;
        credit: number | string;
        memo: string | null;
      }>;
    }>;
    let prevHash = "GENESIS";
    let totalDebits = 0;
    let totalCredits = 0;
    const entries = [];
    for (const row of rows) {
      const lines = Array.isArray(row.lines) ? row.lines : [];
      for (const l of lines) {
        totalDebits += Number(l.debit) || 0;
        totalCredits += Number(l.credit) || 0;
      }
      const core = {
        id: row.id,
        entry_date: row.entry_date,
        memo: row.memo,
        source_type: row.source_type,
        source_id: row.source_id,
        currency: row.currency,
        amount: row.amount,
        lines,
      };
      const contentHash = await sha256Hex(JSON.stringify(core));
      const chainHash = await sha256Hex(prevHash + contentHash);
      entries.push({ ...core, contentHash, prevHash, chainHash });
      prevHash = chainHash;
    }
    return json({
      from,
      to,
      currency: "KES",
      count: entries.length,
      balanced: Math.round(totalDebits) === Math.round(totalCredits),
      totalDebits,
      totalCredits,
      finalHash: prevHash,
      entries,
    });
  }

  const ledgerMatch = path.match(/^\/api\/accounting\/ledger\/([^/]+)$/);
  if (ledgerMatch && request.method === "GET") {
    const code = ledgerMatch[1];
    if (!VALID_CODES.has(code)) return json({ error: "unknown account" }, 404);
    return json(await generalLedger(sql, venue, code, from, to));
  }

  if (path === "/api/accounting/ar-aging" && request.method === "GET") {
    return json(await arAging(sql, venue));
  }

  if (path === "/api/accounting/lost-basket" && request.method === "GET") {
    return json({ from, to, ...(await lostBasket(sql, venue, from, to)) });
  }

  // One-shot dashboard rollup.
  if (path === "/api/accounting/summary" && request.method === "GET") {
    const [pnl, sheet, tb, ar, basket] = await Promise.all([
      incomeStatement(sql, venue, from, to),
      balanceSheet(sql, venue, to),
      trialBalance(sql, venue, from, to),
      arAging(sql, venue),
      lostBasket(sql, venue, from, to),
    ]);
    return json({
      from,
      to,
      currency: "KES",
      incomeStatement: pnl,
      balanceSheet: sheet,
      trialBalanceBalanced: tb.balanced,
      arAging: ar,
      lostBasket: basket,
    });
  }

  // --- Period close / lock ---
  if (path === "/api/accounting/periods" && request.method === "GET") {
    return json({ periods: await listPeriods(sql, venue) });
  }

  if (path === "/api/accounting/period/close" && request.method === "POST") {
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!POST_ROLES.has(role)) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      period_end?: string;
      note?: string;
    };
    const periodEnd = body.period_end ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return json({ error: "period_end (YYYY-MM-DD) required" }, 400);
    }
    const by = typeof payload.sub === "string" ? payload.sub : null;
    return json(
      { ok: true, period: await closePeriod(sql, venue, periodEnd, by, body.note ?? null) },
      201,
    );
  }

  if (path === "/api/accounting/period/reopen" && request.method === "POST") {
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!POST_ROLES.has(role)) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as { period_end?: string };
    const periodEnd = body.period_end ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return json({ error: "period_end (YYYY-MM-DD) required" }, 400);
    }
    const reopened = await reopenPeriod(sql, venue, periodEnd);
    if (!reopened) return json({ error: "period not found" }, 404);
    return json({ ok: true, period: reopened });
  }

  // Manual journal adjustment (accountant-only). Body is validated + balanced by
  // postEntry, which rejects any entry whose debits != credits.
  if (path === "/api/accounting/journal" && request.method === "POST") {
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!POST_ROLES.has(role)) return json({ error: "forbidden" }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      memo?: string;
      date?: string;
      currency?: string;
      lines?: Array<{
        account?: string;
        debit?: number;
        credit?: number;
        memo?: string;
      }>;
    };
    const lines = (body.lines ?? []).filter(
      (l) => l.account && VALID_CODES.has(l.account),
    );
    if (lines.length < 2) {
      return json({ error: "at least two valid lines required" }, 400);
    }
    try {
      const id = await postEntry(sql, {
        venue,
        sourceType: "manual",
        sourceId: crypto.randomUUID(),
        memo: body.memo ?? "Manual adjustment",
        currency: body.currency,
        date: body.date,
        createdBy: typeof payload.sub === "string" ? payload.sub : null,
        lines: lines.map((l) => ({
          account: l.account as string,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo,
        })),
      });
      return json({ ok: true, id }, 201);
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : "invalid entry" },
        400,
      );
    }
  }

  return null;
}
