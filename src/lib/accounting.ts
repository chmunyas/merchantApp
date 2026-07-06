import { getSql } from "@/lib/db";

type Sql = NonNullable<ReturnType<typeof getSql>>;

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
  sql: Sql,
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

  return sql.begin(async (tx) => {
    const [entry] = await tx`
      INSERT INTO journal_entries
        (venue_id, entry_date, memo, source_type, source_id, currency, amount, created_by)
      VALUES (${input.venue}, ${entryDate}, ${input.memo ?? null}, ${input.sourceType},
              ${input.sourceId}, ${currency}, ${totalDebit}, ${input.createdBy ?? null})
      ON CONFLICT (venue_id, source_type, source_id) DO NOTHING
      RETURNING id`;
    if (!entry) return null; // already posted
    for (const l of lines) {
      await tx`
        INSERT INTO journal_lines
          (entry_id, venue_id, entry_date, account_code, debit, credit, memo)
        VALUES (${entry.id}, ${input.venue}, ${entryDate}, ${l.account},
                ${l.debit}, ${l.credit}, ${l.memo})`;
    }
    return String(entry.id);
  });
}

// --- Event posting wrappers (called best-effort from the source flows) -----

export function postPaymentEntry(
  sql: Sql,
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
  sql: Sql,
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
  sql: Sql,
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
  sql: Sql,
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

// --- Reports --------------------------------------------------------------

export type TrialBalanceRow = {
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number; // signed on the account's normal side
};

async function accountTotals(sql: Sql, venue: string, from: string, to: string) {
  return sql`
    SELECT a.code, a.name, a.type, a.normal_side,
           COALESCE(sum(l.debit), 0)::bigint  AS debit,
           COALESCE(sum(l.credit), 0)::bigint AS credit
    FROM ledger_accounts a
    LEFT JOIN journal_lines l
      ON l.account_code = a.code
     AND l.venue_id = ${venue}
     AND l.entry_date::date BETWEEN ${from} AND ${to}
    GROUP BY a.code, a.name, a.type, a.normal_side, a.sort_order
    ORDER BY a.sort_order`;
}

export async function trialBalance(
  sql: Sql,
  venue: string,
  from?: string,
  to?: string,
): Promise<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number; balanced: boolean }> {
  const raw = await accountTotals(sql, venue, from ?? MIN, to ?? MAX);
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
) {
  const { rows } = await trialBalance(sql, venue, from, to);
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

export async function balanceSheet(sql: Sql, venue: string, asOf?: string) {
  const { rows } = await trialBalance(sql, venue, MIN, asOf ?? MAX);
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
    GROUP BY e.id
    ORDER BY e.entry_date DESC, e.created_at DESC
    LIMIT ${limit}`;
  return entries;
}

// Accounts-Receivable aging: outstanding invoice balances by age bucket. Invoices
// are the AR subledger — a customer bill that is issued but not yet paid.
export async function arAging(sql: Sql, venue: string) {
  const [row] = await sql`
    SELECT
      COALESCE(sum(bal),0)::numeric AS total,
      COALESCE(sum(bal) FILTER (WHERE age <= 30),0)::numeric  AS d0_30,
      COALESCE(sum(bal) FILTER (WHERE age > 30 AND age <= 60),0)::numeric AS d31_60,
      COALESCE(sum(bal) FILTER (WHERE age > 60 AND age <= 90),0)::numeric AS d61_90,
      COALESCE(sum(bal) FILTER (WHERE age > 90),0)::numeric AS d90_plus,
      count(*)::int AS open_count
    FROM (
      SELECT (amount - amount_paid) AS bal,
             GREATEST(0, (CURRENT_DATE - created_at::date)) AS age
      FROM invoices
      WHERE venue_id = ${venue}
        AND status NOT IN ('paid','void')
        AND (amount - amount_paid) > 0
    ) x`;
  const outstanding = await sql`
    SELECT number, customer_name, phone, currency,
           (amount - amount_paid) AS balance, due_date, created_at,
           GREATEST(0, (CURRENT_DATE - created_at::date)) AS age_days
    FROM invoices
    WHERE venue_id = ${venue}
      AND status NOT IN ('paid','void')
      AND (amount - amount_paid) > 0
    ORDER BY created_at
    LIMIT 100`;
  return {
    total: Number(row?.total ?? 0),
    buckets: {
      d0_30: Number(row?.d0_30 ?? 0),
      d31_60: Number(row?.d31_60 ?? 0),
      d61_90: Number(row?.d61_90 ?? 0),
      d90_plus: Number(row?.d90_plus ?? 0),
    },
    openCount: Number(row?.open_count ?? 0),
    invoices: outstanding,
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
      AND created_at::date BETWEEN ${from ?? MIN} AND ${to ?? MAX}`;
  const paidCount = Number(row?.paid_count ?? 0);
  const abandonedCount = Number(row?.abandoned_count ?? 0);
  const totalBaskets = paidCount + Number(row?.open_count ?? 0);
  const baskets = await sql`
    SELECT id, table_id, total, currency, status, created_at
    FROM orders
    WHERE venue_id = ${venue}
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
