import { getSql } from "@/lib/db";
import type { QuerySql, Sql } from "@/lib/db";
import { buildAgingReport } from "@/lib/ar-aging";
import { sha256Hex } from "@/lib/hash";
import { DEFAULT_CURRENCY, minorUnitFactor, type SupportedCurrency } from "@/lib/currency";

type RootSql = NonNullable<ReturnType<typeof getSql>>;

// --- Chart of accounts (mirrors db/30-accounting.sql) ---------------------
export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "contra_revenue"
  | "expense";

export type Account = {
  code: string;
  name: string;
  type: AccountType;
  normal: "debit" | "credit";
};

export const CHART: Account[] = [
  { code: "1000", name: "Cash & Mobile Money Clearing", type: "asset", normal: "debit" },
  { code: "1010", name: "Settled Bank", type: "asset", normal: "debit" },
  { code: "1100", name: "Accounts Receivable", type: "asset", normal: "debit" },
  { code: "1200", name: "Inventory", type: "asset", normal: "debit" },
  { code: "2000", name: "Tips Payable", type: "liability", normal: "credit" },
  { code: "2100", name: "Tax Payable", type: "liability", normal: "credit" },
  { code: "2200", name: "Customer Credits", type: "liability", normal: "credit" },
  { code: "3000", name: "Owner Equity", type: "equity", normal: "credit" },
  { code: "4000", name: "Sales Revenue", type: "revenue", normal: "credit" },
  { code: "4900", name: "Refunds & Returns", type: "contra_revenue", normal: "debit" },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", normal: "debit" },
  { code: "6000", name: "Payment Processing Fees", type: "expense", normal: "debit" },
];

const ACCOUNT_BY_CODE = new Map(CHART.map((a) => [a.code, a]));

export type PostLine = {
  account: string;
  debit?: number;
  credit?: number;
  memo?: string;
};

const round = (n: unknown) => Math.round(Number(n) || 0);
const MIN = "0001-01-01";
const MAX = "9999-12-31";

// --- Pure line builders (balanced by construction; exported for tests) -----

// A succeeded sale: cash in, revenue earned, any tip is a liability owed to
// staff (not revenue). Cash-basis revenue recognition.
export function paymentLines(amount: number, tip = 0): PostLine[] {
  const gross = Math.max(0, round(amount));
  const t = Math.min(gross, Math.max(0, round(tip)));
  const revenue = gross - t;
  const lines: PostLine[] = [{ account: "1000", debit: gross, memo: "Cash received" }];
  if (revenue > 0) lines.push({ account: "4000", credit: revenue, memo: "Sales revenue" });
  if (t > 0) lines.push({ account: "2000", credit: t, memo: "Tip owed to staff" });
  return lines;
}

// A refund reverses cash and books a return (contra-revenue).
export function refundLines(amount: number): PostLine[] {
  const a = Math.max(0, round(amount));
  return [
    { account: "4900", debit: a, memo: "Refund / return" },
    { account: "1000", credit: a, memo: "Cash refunded" },
  ];
}

// A settlement batch moves cleared funds to the bank, net of processing fees.
export function settlementLines(gross: number, fees: number): PostLine[] {
  const g = Math.max(0, round(gross));
  const f = Math.max(0, Math.min(g, round(fees)));
  const net = g - f;
  const lines: PostLine[] = [];
  if (net > 0) lines.push({ account: "1010", debit: net, memo: "Settled to bank" });
  if (f > 0) lines.push({ account: "6000", debit: f, memo: "Processing fees" });
  if (g > 0) lines.push({ account: "1000", credit: g, memo: "Clearing settled" });
  return lines;
}

// Paying pooled tips out to staff clears the liability.
export function tipPayoutLines(amount: number): PostLine[] {
  const a = Math.max(0, round(amount));
  return [
    { account: "2000", debit: a, memo: "Tips paid out" },
    { account: "1010", credit: a, memo: "Cash paid to staff" },
  ];
}

// Issuing an invoice recognises revenue on account (accrual): a receivable is
// created, revenue is earned, and any tax becomes a liability owed to the
// authority. The matching payment later SETTLES the receivable (no new revenue).
export function invoiceIssueLines(subtotal: number, tax = 0): PostLine[] {
  const s = Math.max(0, round(subtotal));
  const t = Math.max(0, round(tax));
  const total = s + t;
  if (total <= 0) return [];
  const lines: PostLine[] = [
    { account: "1100", debit: total, memo: "Invoice issued (A/R)" },
  ];
  if (s > 0) lines.push({ account: "4000", credit: s, memo: "Sales revenue" });
  if (t > 0) lines.push({ account: "2100", credit: t, memo: "Tax payable" });
  return lines;
}

// Paying an invoice settles the receivable — revenue was already booked at issue.
export function invoicePaymentLines(amount: number): PostLine[] {
  const a = Math.max(0, round(amount));
  return [
    { account: "1000", debit: a, memo: "Invoice payment received" },
    { account: "1100", credit: a, memo: "A/R settled" },
  ];
}

// Cost of goods sold: inventory value leaves the balance sheet as an expense
// when a sale is fulfilled.
export function cogsLines(cost: number): PostLine[] {
  const c = Math.max(0, round(cost));
  return [
    { account: "5000", debit: c, memo: "Cost of goods sold" },
    { account: "1200", credit: c, memo: "Inventory consumed" },
  ];
}

export function isBalanced(lines: PostLine[]): boolean {
  const d = lines.reduce((s, l) => s + Math.max(0, round(l.debit ?? 0)), 0);
  const c = lines.reduce((s, l) => s + Math.max(0, round(l.credit ?? 0)), 0);
  return d === c && d > 0;
}

// --- Posting --------------------------------------------------------------

export type PostEntryInput = {
  venue: string;
  sourceType: string;
  sourceId: string;
  lines: PostLine[];
  memo?: string;
  currency?: string;
  date?: Date | string;
  createdBy?: string | null;
};

// Post a balanced double-entry journal entry. Idempotent per (venue, source):
// re-posting the same source event is a no-op. Throws if debits != credits so an
// unbalanced entry can never enter the ledger (audit integrity).
export async function postEntry(
  sql: RootSql,
  input: PostEntryInput,
): Promise<string | null> {
  const lines = input.lines
    .map((line) => ({
      debit: Math.max(0, round(line.debit ?? 0)),
      credit: Math.max(0, round(line.credit ?? 0)),
    }))
    .filter((line) => line.debit > 0 || line.credit > 0);
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (lines.length === 0 || totalDebit === 0) return null;
  if (totalDebit !== totalCredit) {
    throw new Error(
      `unbalanced journal entry (${input.sourceType}:${input.sourceId}): debit ${totalDebit} != credit ${totalCredit}`,
    );
  }
  return sql.begin((tx) => postEntryInTransaction(tx, input));
}

// Transaction-owned posting primitive. The closed-period check, idempotency
// guard, entry, and all lines commit atomically with the caller's projection.
// Consumers already inside a transaction must use this instead of nesting begin().
export async function postEntryInTransaction(
  sql: QuerySql,
  input: PostEntryInput,
): Promise<string | null> {
  const lines = input.lines
    .map((l) => ({
      account: l.account,
      debit: Math.max(0, round(l.debit ?? 0)),
      credit: Math.max(0, round(l.credit ?? 0)),
      memo: l.memo ?? null,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (lines.length === 0 || totalDebit === 0) return null;
  if (totalDebit !== totalCredit) {
    throw new Error(
      `unbalanced journal entry (${input.sourceType}:${input.sourceId}): debit ${totalDebit} != credit ${totalCredit}`,
    );
  }
  const currency = input.currency ?? "KES";
  const entryDate = input.date ? new Date(input.date) : new Date();

  await sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`ledger-period:${input.venue}`}, 0))`;

  // A closed period is locked: nothing may post on or before its period_end.
  if (await isPeriodClosed(sql, input.venue, entryDate)) {
    throw new Error(
      `accounting period closed on/before ${entryDate.toISOString().slice(0, 10)}`,
    );
  }

  const [entry] = await sql`
      INSERT INTO journal_entries
        (venue_id, entry_date, memo, source_type, source_id, currency, amount, created_by)
      VALUES (${input.venue}, ${entryDate}, ${input.memo ?? null}, ${input.sourceType},
              ${input.sourceId}, ${currency}, ${totalDebit}, ${input.createdBy ?? null})
      ON CONFLICT (venue_id, source_type, source_id) DO NOTHING
      RETURNING id`;
  if (!entry) return null; // already posted
  for (const l of lines) {
    await sql`
        INSERT INTO journal_lines
          (entry_id, venue_id, entry_date, account_code, debit, credit, memo)
        VALUES (${entry.id}, ${input.venue}, ${entryDate}, ${l.account},
                ${l.debit}, ${l.credit}, ${l.memo})`;
  }
  return String(entry.id);
}

// --- Event posting wrappers (called best-effort from the source flows) -----

export function postPaymentEntry(
  sql: RootSql,
  p: { venue: string; id: string; amount: number; tip?: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntry(sql, {
    venue: p.venue,
    sourceType: "payment",
    sourceId: p.id,
    currency: p.currency,
    date: p.date,
    memo: "Payment received",
    lines: paymentLines(p.amount, p.tip ?? 0),
  });
}

export function postRefundEntry(
  sql: RootSql,
  p: { venue: string; id: string; amount: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntry(sql, {
    venue: p.venue,
    sourceType: "refund",
    sourceId: p.id,
    currency: p.currency,
    date: p.date,
    memo: "Payment refunded",
    lines: refundLines(p.amount),
  });
}

export function postSettlementEntry(
  sql: RootSql,
  p: { venue: string; id: string; gross: number; fees: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntry(sql, {
    venue: p.venue,
    sourceType: "settlement",
    sourceId: p.id,
    currency: p.currency,
    date: p.date,
    memo: "Settlement to bank",
    lines: settlementLines(p.gross, p.fees),
  });
}

export function postTipPayoutEntry(
  sql: RootSql,
  p: { venue: string; id: string; amount: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntry(sql, {
    venue: p.venue,
    sourceType: "tip_payout",
    sourceId: p.id,
    currency: p.currency,
    date: p.date,
    memo: "Tips paid out",
    lines: tipPayoutLines(p.amount),
  });
}

export function postInvoiceIssueEntry(
  sql: RootSql,
  p: { venue: string; number: string; subtotal: number; tax?: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntry(sql, {
    venue: p.venue,
    sourceType: "invoice",
    sourceId: p.number,
    currency: p.currency,
    date: p.date,
    memo: `Invoice ${p.number} issued`,
    lines: invoiceIssueLines(p.subtotal, p.tax ?? 0),
  });
}

export function postInvoicePaymentEntry(
  sql: RootSql,
  p: { venue: string; sourceId: string; amount: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntry(sql, {
    venue: p.venue,
    sourceType: "invoice_payment",
    sourceId: p.sourceId,
    currency: p.currency,
    date: p.date,
    memo: "Invoice payment (A/R settled)",
    lines: invoicePaymentLines(p.amount),
  });
}

export function postCogsEntry(
  sql: RootSql,
  p: { venue: string; orderId: string; cost: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntry(sql, {
    venue: p.venue,
    sourceType: "cogs",
    sourceId: p.orderId,
    currency: p.currency,
    date: p.date,
    memo: "Cost of goods sold",
    lines: cogsLines(p.cost),
  });
}

export function postPaymentEntryInTransaction(
  sql: QuerySql,
  p: { venue: string; id: string; amount: number; tip?: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntryInTransaction(sql, {
    venue: p.venue,
    sourceType: "payment",
    sourceId: p.id,
    currency: p.currency,
    date: p.date,
    memo: "Payment received",
    lines: paymentLines(p.amount, p.tip ?? 0),
  });
}

export function postCogsEntryInTransaction(
  sql: QuerySql,
  p: { venue: string; orderId: string; cost: number; currency?: string; date?: Date | string },
): Promise<string | null> {
  return postEntryInTransaction(sql, {
    venue: p.venue,
    sourceType: "cogs",
    sourceId: p.orderId,
    currency: p.currency,
    date: p.date,
    memo: "Cost of goods sold",
    lines: cogsLines(p.cost),
  });
}

// --- Period close / lock --------------------------------------------------

// A date is locked if it falls on or before the period_end of any CLOSED period.
export async function isPeriodClosed(
  sql: QuerySql,
  venue: string,
  date: Date | string,
): Promise<boolean> {
  const d =
    typeof date === "string" ? date : new Date(date).toISOString().slice(0, 10);
  const [row] = await sql`
    SELECT 1 FROM ledger_periods
    WHERE venue_id = ${venue} AND status = 'closed' AND period_end >= ${d}
    LIMIT 1`;
  return Boolean(row);
}

export async function closePeriod(
  sql: Sql,
  venue: string,
  periodEnd: string,
  by?: string | null,
  note?: string | null,
) {
  return sql.begin(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtextextended(${`ledger-period:${venue}`}, 0))`;
    const [row] = await tx`
      INSERT INTO ledger_periods (venue_id, period_end, status, note, closed_by)
      VALUES (${venue}, ${periodEnd}, 'closed', ${note ?? null}, ${by ?? null})
      ON CONFLICT (venue_id, period_end)
      DO UPDATE SET status = 'closed', closed_at = now(),
                    closed_by = ${by ?? null}, note = ${note ?? null}
      RETURNING period_end, status, closed_at, closed_by, note`;
    await tx`
      INSERT INTO ledger_period_events (venue_id, period_end, event_type, actor, note)
      VALUES (${venue}, ${periodEnd}, 'closed', ${by ?? null}, ${note ?? null})`;
    await createAuditCheckpointInTransaction(tx, venue, periodEnd, by ?? null);
    return row;
  });
}

export async function reopenPeriod(sql: Sql, venue: string, periodEnd: string) {
  return sql.begin(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtextextended(${`ledger-period:${venue}`}, 0))`;
    const [row] = await tx`
      UPDATE ledger_periods SET status = 'open'
      WHERE venue_id = ${venue} AND period_end = ${periodEnd}
      RETURNING period_end, status`;
    if (row) {
      await tx`
        INSERT INTO ledger_period_events (venue_id, period_end, event_type, actor)
        VALUES (${venue}, ${periodEnd}, 'reopened', NULL)`;
    }
    return row ?? null;
  });
}

export async function createAuditCheckpointInTransaction(
  sql: QuerySql,
  venue: string,
  periodEnd: string,
  _actor?: string | null,
  // One hash chain per currency: the ledger is currency-segregated, and
  // ledger_audit_checkpoints is already keyed on (venue, currency, period_end).
  currency: SupportedCurrency = DEFAULT_CURRENCY,
): Promise<Record<string, unknown>> {
  const [previous] = await sql`
    SELECT final_hash FROM ledger_audit_checkpoints
    WHERE venue_id = ${venue} AND currency = ${currency} AND period_end < ${periodEnd}
    ORDER BY period_end DESC, created_at DESC LIMIT 1`;
  let chain = String(previous?.final_hash ?? "GENESIS");
  const entries = await sql`
    SELECT e.id, e.entry_date, e.created_at, e.created_by, e.memo,
           e.source_type, e.source_id, e.currency, e.amount,
           COALESCE(json_agg(json_build_object(
             'id', l.id, 'account', l.account_code, 'debit', l.debit,
             'credit', l.credit, 'memo', l.memo
           ) ORDER BY l.id), '[]') AS lines
    FROM journal_entries e
    LEFT JOIN journal_lines l ON l.entry_id = e.id
    WHERE e.venue_id = ${venue} AND e.currency = ${currency}
      AND e.entry_date::date <= ${periodEnd}
    GROUP BY e.id
    ORDER BY e.entry_date, e.created_at, e.id`;
  for (const entry of entries) {
    const content = JSON.stringify({
      id: String(entry.id),
      entryDate: new Date(entry.entry_date as string).toISOString(),
      createdAt: new Date(entry.created_at as string).toISOString(),
      createdBy: entry.created_by ?? null,
      memo: entry.memo ?? null,
      sourceType: entry.source_type,
      sourceId: entry.source_id,
      currency: entry.currency,
      amount: String(entry.amount),
      lines: entry.lines,
    });
    chain = await sha256Hex(chain + await sha256Hex(content));
  }
  const [checkpoint] = await sql`
    INSERT INTO ledger_audit_checkpoints
      (venue_id, currency, period_end, entry_count, previous_hash, final_hash)
    VALUES (${venue}, ${currency}, ${periodEnd}, ${entries.length},
            ${String(previous?.final_hash ?? "GENESIS")}, ${chain})
    ON CONFLICT (venue_id, currency, period_end, final_hash) DO NOTHING
    RETURNING id, venue_id, currency, period_end, algorithm, entry_count,
              previous_hash, final_hash, created_at`;
  if (checkpoint) return checkpoint;
  const [existing] = await sql`
    SELECT id, venue_id, currency, period_end, algorithm, entry_count,
           previous_hash, final_hash, created_at
    FROM ledger_audit_checkpoints
    WHERE venue_id = ${venue} AND currency = ${currency} AND period_end = ${periodEnd}
      AND final_hash = ${chain}
    ORDER BY created_at DESC LIMIT 1`;
  return existing;
}

export async function listPeriods(sql: Sql, venue: string) {
  return sql`
    SELECT period_end, status, closed_at, closed_by, note
    FROM ledger_periods WHERE venue_id = ${venue}
    ORDER BY period_end DESC LIMIT 60`;
}

// --- Reports --------------------------------------------------------------

export type TrialBalanceRow = {
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number; // signed on the account's normal side
};

async function accountTotals(sql: Sql, venue: string, from: string, to: string, currency = "KES") {
  return sql`
    SELECT a.code, a.name, a.type, a.normal_side,
           COALESCE(sum(l.debit), 0)::bigint  AS debit,
           COALESCE(sum(l.credit), 0)::bigint AS credit
    FROM ledger_accounts a
    LEFT JOIN journal_lines l
      ON l.account_code = a.code
     AND l.venue_id = ${venue}
    AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = l.entry_id AND je.currency = ${currency})
     AND l.entry_date::date BETWEEN ${from} AND ${to}
    GROUP BY a.code, a.name, a.type, a.normal_side, a.sort_order
    ORDER BY a.sort_order`;
}

export async function trialBalance(
  sql: Sql,
  venue: string,
  from?: string,
  to?: string,
  currency = "KES",
): Promise<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number; balanced: boolean }> {
  const raw = await accountTotals(sql, venue, from ?? MIN, to ?? MAX, currency);
  const rows: TrialBalanceRow[] = raw.map((r) => {
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    const balance =
      r.normal_side === "debit" ? debit - credit : credit - debit;
    return {
      code: String(r.code),
      name: String(r.name),
      type: r.type as AccountType,
      debit,
      credit,
      balance,
    };
  });
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

export async function incomeStatement(
  sql: Sql,
  venue: string,
  from?: string,
  to?: string,
  currency = "KES",
) {
  const { rows } = await trialBalance(sql, venue, from, to, currency);
  const revenue = rows
    .filter((r) => r.type === "revenue")
    .reduce((s, r) => s + r.balance, 0);
  const returns = rows
    .filter((r) => r.type === "contra_revenue")
    .reduce((s, r) => s + r.balance, 0);
  const expenses = rows
    .filter((r) => r.type === "expense")
    .reduce((s, r) => s + r.balance, 0);
  const netRevenue = revenue - returns;
  const netIncome = netRevenue - expenses;
  return {
    revenue,
    returns,
    netRevenue,
    expenses,
    netIncome,
    lines: rows.filter((r) =>
      ["revenue", "contra_revenue", "expense"].includes(r.type),
    ),
  };
}

export async function balanceSheet(sql: Sql, venue: string, asOf?: string, currency = "KES") {
  const { rows } = await trialBalance(sql, venue, MIN, asOf ?? MAX, currency);
  const sum = (type: AccountType) =>
    rows.filter((r) => r.type === type).reduce((s, r) => s + r.balance, 0);
  const assets = sum("asset");
  const liabilities = sum("liability");
  const equityPosted = sum("equity");
  // Retained earnings roll up all P&L activity to date into equity so the sheet
  // balances (Assets = Liabilities + Equity).
  const retainedEarnings =
    sum("revenue") - sum("contra_revenue") - sum("expense");
  const equity = equityPosted + retainedEarnings;
  return {
    assets,
    liabilities,
    equity,
    equityPosted,
    retainedEarnings,
    balanced: assets === liabilities + equity,
    accounts: rows.filter((r) =>
      ["asset", "liability", "equity"].includes(r.type),
    ),
  };
}

export async function generalLedger(
  sql: Sql,
  venue: string,
  code: string,
  from?: string,
  to?: string,
  currency = "KES",
) {
  const account = ACCOUNT_BY_CODE.get(code);
  const lines = await sql`
    SELECT l.entry_date, l.debit, l.credit, l.memo,
           e.source_type, e.source_id, e.memo AS entry_memo
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.venue_id = ${venue}
      AND l.account_code = ${code}
      AND l.entry_date::date BETWEEN ${from ?? MIN} AND ${to ?? MAX}
      AND e.currency = ${currency}
    ORDER BY l.entry_date, e.created_at`;
  let running = 0;
  const sign = account?.normal === "credit" ? -1 : 1;
  const withBalance = lines.map((l) => {
    running += sign * (Number(l.debit) - Number(l.credit));
    return {
      date: l.entry_date,
      debit: Number(l.debit),
      credit: Number(l.credit),
      memo: l.memo ?? l.entry_memo,
      sourceType: l.source_type,
      sourceId: l.source_id,
      balance: running,
    };
  });
  return { account: account ?? null, lines: withBalance };
}

export async function journalList(
  sql: Sql,
  venue: string,
  from?: string,
  to?: string,
  limit = 200,
  currency = "KES",
) {
  const entries = await sql`
    SELECT e.id, e.entry_date, e.memo, e.source_type, e.source_id, e.currency, e.amount,
           COALESCE(json_agg(json_build_object(
             'account', l.account_code, 'debit', l.debit, 'credit', l.credit, 'memo', l.memo
           ) ORDER BY l.debit DESC), '[]') AS lines
    FROM journal_entries e
    LEFT JOIN journal_lines l ON l.entry_id = e.id
    WHERE e.venue_id = ${venue}
      AND e.entry_date::date BETWEEN ${from ?? MIN} AND ${to ?? MAX}
      AND e.currency = ${currency}
    GROUP BY e.id
    ORDER BY e.entry_date DESC, e.created_at DESC
    LIMIT ${limit}`;
  return entries;
}

// Journal entries ordered OLDEST-first — the deterministic input for the
// tamper-evident audit hash chain (see GET /api/accounting/audit).
export async function auditEntries(
  sql: Sql,
  venue: string,
  from?: string,
  to?: string,
  limit = 5000,
  currency = "KES",
) {
  return sql`
    SELECT e.id, e.entry_date, e.created_at, e.created_by, e.memo,
           e.source_type, e.source_id, e.currency, e.amount,
           COALESCE(json_agg(json_build_object(
             'id', l.id, 'account', l.account_code, 'debit', l.debit,
             'credit', l.credit, 'memo', l.memo
           ) ORDER BY l.id), '[]') AS lines
    FROM journal_entries e
    LEFT JOIN journal_lines l ON l.entry_id = e.id
    WHERE e.venue_id = ${venue}
      AND e.entry_date::date BETWEEN ${from ?? MIN} AND ${to ?? MAX}
      AND e.currency = ${currency}
    GROUP BY e.id
    ORDER BY e.entry_date ASC, e.created_at ASC, e.id ASC
    LIMIT ${limit}`;
}

// Accounts-Receivable aging: outstanding invoice balances by age bucket. Invoices
// are the AR subledger — a customer bill that is issued but not yet paid.
export async function arAging(
  sql: Sql,
  venue: string,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
) {
  // SQL retrieves; src/lib/ar-aging.ts decides. Ageing is an accounting policy
  // (it runs from the DUE date), not a database detail, so it is unit-tested.
  // Rows are single-currency (filtered below), so the factor is known here.
  const factor = minorUnitFactor(currency);
  const rows = await sql`
    SELECT number, customer_name, phone,
           ROUND((amount - amount_paid) * ${factor})::bigint AS balance_minor,
           due_date, created_at
    FROM invoices
    WHERE venue_id = ${venue}
      AND currency = ${currency}
      AND status NOT IN ('paid','void')
      AND (amount - amount_paid) > 0
    ORDER BY COALESCE(due_date, created_at::date)
    LIMIT 1000`;

  const report = buildAgingReport(
    rows.map((row) => ({
      number: String(row.number),
      customerName: (row.customer_name as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      balanceMinor: Number(row.balance_minor) || 0,
      dueDate: row.due_date ? String(row.due_date) : null,
      issuedAt: new Date(row.created_at as string).toISOString(),
    })),
  );

  return {
    asOf: report.asOf,
    total: report.totalMinor,
    totalMinor: report.totalMinor,
    overdueMinor: report.overdueMinor,
    buckets: report.buckets,
    openCount: report.openCount,
    customers: report.customers,
    invoices: report.invoices.slice(0, 100),
  };
}

// Lost-basket analysis: orders that were built but never paid. `abandoned` are
// unpaid baskets older than the stale window (a proxy for a lost sale).
export async function lostBasket(
  sql: Sql,
  venue: string,
  from?: string,
  to?: string,
  staleHours = 2,
  currency = "KES",
) {
  const [row] = await sql`
    SELECT
      count(*) FILTER (WHERE paid_at IS NOT NULL)::int AS paid_count,
      count(*) FILTER (WHERE paid_at IS NULL)::int AS open_count,
      COALESCE(sum(total) FILTER (WHERE paid_at IS NOT NULL),0)::bigint AS paid_value,
      COALESCE(sum(total) FILTER (WHERE paid_at IS NULL),0)::bigint AS open_value,
      count(*) FILTER (WHERE paid_at IS NULL AND created_at < now() - (${staleHours} || ' hours')::interval)::int AS abandoned_count,
      COALESCE(sum(total) FILTER (WHERE paid_at IS NULL AND created_at < now() - (${staleHours} || ' hours')::interval),0)::bigint AS abandoned_value
    FROM orders
    WHERE venue_id = ${venue}
      AND currency = ${currency}
      AND created_at::date BETWEEN ${from ?? MIN} AND ${to ?? MAX}`;
  const paidCount = Number(row?.paid_count ?? 0);
  const abandonedCount = Number(row?.abandoned_count ?? 0);
  const totalBaskets = paidCount + Number(row?.open_count ?? 0);
  const baskets = await sql`
    SELECT id, table_id, total, currency, status, created_at
    FROM orders
    WHERE venue_id = ${venue}
      AND currency = ${currency}
      AND paid_at IS NULL
      AND created_at < now() - (${staleHours} || ' hours')::interval
      AND created_at::date BETWEEN ${from ?? MIN} AND ${to ?? MAX}
    ORDER BY created_at DESC
    LIMIT 50`;
  return {
    paidCount,
    openCount: Number(row?.open_count ?? 0),
    paidValue: Number(row?.paid_value ?? 0),
    openValue: Number(row?.open_value ?? 0),
    abandonedCount,
    abandonedValue: Number(row?.abandoned_value ?? 0),
    conversionRate: totalBaskets > 0 ? paidCount / totalBaskets : null,
    abandonmentRate: totalBaskets > 0 ? abandonedCount / totalBaskets : null,
    baskets,
  };
}
