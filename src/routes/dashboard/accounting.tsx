import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/accounting")({
  component: AccountingPage,
});

type TBRow = {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
};

type Summary = {
  from: string;
  to: string;
  currency: string;
  incomeStatement: {
    revenue: number;
    returns: number;
    netRevenue: number;
    expenses: number;
    netIncome: number;
    lines: TBRow[];
  };
  balanceSheet: {
    assets: number;
    liabilities: number;
    equity: number;
    retainedEarnings: number;
    balanced: boolean;
    accounts: TBRow[];
  };
  trialBalanceBalanced: boolean;
  arAging: {
    total: number;
    buckets: { d0_30: number; d31_60: number; d61_90: number; d90_plus: number };
    openCount: number;
  };
  lostBasket: {
    paidCount: number;
    openCount: number;
    paidValue: number;
    abandonedCount: number;
    abandonedValue: number;
    conversionRate: number | null;
    abandonmentRate: number | null;
  };
};

type JournalEntry = {
  id: string;
  entry_date: string;
  memo: string | null;
  source_type: string;
  source_id: string;
  amount: number;
  lines: Array<{ account: string; debit: number; credit: number; memo: string | null }>;
};

const kes = (minor: number) =>
  `KES ${(Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}%`;

function isoDaysAgo(n: number) {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

function AccountingPage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tb, setTb] = useState<{
    rows: TBRow[];
    totalDebit: number;
    totalCredit: number;
    balanced: boolean;
  } | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [periodEnd, setPeriodEnd] = useState(isoDaysAgo(0));

  const load = useCallback(
    async (f = from, t = to) => {
      if (!f || !t) return;
      setLoading(true);
      try {
        const [sumRes, tbRes, jRes] = await Promise.all([
          authFetch(`/api/accounting/summary?from=${f}&to=${t}`),
          authFetch(`/api/accounting/trial-balance?from=${f}&to=${t}`),
          authFetch(`/api/accounting/journal?from=${f}&to=${t}&limit=100`),
        ]);
        setSummary(sumRes.ok ? ((await sumRes.json()) as Summary) : null);
        setTb(tbRes.ok ? await tbRes.json() : null);
        setJournal(jRes.ok ? ((await jRes.json()) as { entries: JournalEntry[] }).entries : []);
      } catch {
        toast.error("Couldn't load the ledger");
      } finally {
        setLoading(false);
      }
    },
    [from, to],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportTrialBalanceCsv() {
    if (!tb) return;
    const rows = [
      ["Code", "Account", "Type", "Debit", "Credit"],
      ...tb.rows.map((r) => [
        r.code,
        r.name,
        r.type,
        (r.debit / 100).toFixed(2),
        (r.credit / 100).toFixed(2),
      ]),
      ["", "TOTAL", "", (tb.totalDebit / 100).toFixed(2), (tb.totalCredit / 100).toFixed(2)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `trial-balance-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function closePeriodNow() {
    const r = await authFetch("/api/accounting/period/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period_end: periodEnd }),
    });
    if (r.ok) {
      toast.success(`Books closed through ${periodEnd}`);
      void load();
    } else {
      toast.error("Couldn't close the period");
    }
  }

  async function reopenPeriodNow() {
    const r = await authFetch("/api/accounting/period/reopen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period_end: periodEnd }),
    });
    if (r.ok) toast.success(`Period ${periodEnd} reopened`);
    else toast.error("Couldn't reopen the period");
  }

  async function payoutTips() {
    const r = await authFetch("/api/tips/payout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (r.ok) {
      const d = (await r.json()) as { total: number; paidCount: number };
      toast.success(
        d.total > 0
          ? `Paid out ${kes(d.total)} to ${d.paidCount} staff`
          : "No tips awaiting payout",
      );
      void load();
    } else {
      toast.error("Couldn't pay out tips");
    }
  }

  const is = summary?.incomeStatement;
  const bs = summary?.balanceSheet;
  const ar = summary?.arAging;
  const lb = summary?.lostBasket;

  return (
    <div className="space-y-6 p-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Accounting Ledger</h1>
          <p className="text-sm text-muted-foreground">
            Double-entry general ledger — every payment, refund, settlement and
            adjustment posts a balanced journal entry.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Apply"}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {summary && !summary.trialBalanceBalanced && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          ⚠ Trial balance is out of balance — debits ≠ credits. Investigate before
          relying on these statements.
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Net revenue" value={is ? kes(is.netRevenue) : "—"} />
        <Kpi label="Net income" value={is ? kes(is.netIncome) : "—"} />
        <Kpi
          label="Cash + bank"
          value={
            bs
              ? kes(
                  bs.accounts
                    .filter((a) => a.code === "1000" || a.code === "1010")
                    .reduce((s, a) => s + a.balance, 0),
                )
              : "—"
          }
        />
        <Kpi
          label="A/R outstanding"
          value={ar ? kes(ar.total) : "—"}
          sub={ar ? `${ar.openCount} open` : ""}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Income statement */}
        <Card>
          <CardHeader>
            <CardTitle>Income statement (P&L)</CardTitle>
            <CardDescription>
              {summary?.from} → {summary?.to} · cash basis
            </CardDescription>
          </CardHeader>
          <CardContent>
            {is ? (
              <Table>
                <TableBody>
                  <Line label="Sales revenue" value={kes(is.revenue)} />
                  <Line label="Less: refunds & returns" value={`(${kes(is.returns)})`} />
                  <Line label="Net revenue" value={kes(is.netRevenue)} strong />
                  <Line label="Less: expenses" value={`(${kes(is.expenses)})`} />
                  <Line label="Net income" value={kes(is.netIncome)} strong />
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No data.</p>
            )}
          </CardContent>
        </Card>

        {/* Balance sheet */}
        <Card>
          <CardHeader>
            <CardTitle>Balance sheet</CardTitle>
            <CardDescription>
              As of {summary?.to} ·{" "}
              {bs?.balanced ? (
                <span className="text-emerald-600">balanced</span>
              ) : (
                <span className="text-red-600">unbalanced</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bs ? (
              <Table>
                <TableBody>
                  <Line label="Total assets" value={kes(bs.assets)} strong />
                  <Line label="Total liabilities" value={kes(bs.liabilities)} />
                  <Line label="Retained earnings" value={kes(bs.retainedEarnings)} />
                  <Line label="Total equity" value={kes(bs.equity)} strong />
                  <Line
                    label="Liabilities + equity"
                    value={kes(bs.liabilities + bs.equity)}
                    strong
                  />
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No data.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* AR aging */}
        <Card>
          <CardHeader>
            <CardTitle>Accounts receivable — aging</CardTitle>
            <CardDescription>Unpaid invoices (AR subledger)</CardDescription>
          </CardHeader>
          <CardContent>
            {ar ? (
              <Table>
                <TableBody>
                  <Line label="Current (0–30 days)" value={kes(ar.buckets.d0_30)} />
                  <Line label="31–60 days" value={kes(ar.buckets.d31_60)} />
                  <Line label="61–90 days" value={kes(ar.buckets.d61_90)} />
                  <Line label="90+ days" value={kes(ar.buckets.d90_plus)} />
                  <Line label="Total outstanding" value={kes(ar.total)} strong />
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No data.</p>
            )}
          </CardContent>
        </Card>

        {/* Lost basket */}
        <Card>
          <CardHeader>
            <CardTitle>Lost basket analysis</CardTitle>
            <CardDescription>Orders built but never paid</CardDescription>
          </CardHeader>
          <CardContent>
            {lb ? (
              <Table>
                <TableBody>
                  <Line label="Paid baskets" value={String(lb.paidCount)} />
                  <Line label="Open baskets" value={String(lb.openCount)} />
                  <Line
                    label="Abandoned"
                    value={`${lb.abandonedCount} · ${kes(lb.abandonedValue)}`}
                  />
                  <Line label="Conversion rate" value={pct(lb.conversionRate)} strong />
                  <Line label="Abandonment rate" value={pct(lb.abandonmentRate)} />
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No data.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trial balance */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Trial balance</CardTitle>
            <CardDescription>
              {tb?.balanced ? (
                <span className="text-emerald-600">Debits = credits ✓</span>
              ) : (
                <span className="text-red-600">Out of balance</span>
              )}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={exportTrialBalanceCsv}>
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tb?.rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.debit ? kes(r.debit) : ""}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.credit ? kes(r.credit) : ""}
                  </TableCell>
                </TableRow>
              ))}
              {tb && (
                <TableRow className="font-bold">
                  <TableCell />
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono">
                    {kes(tb.totalDebit)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {kes(tb.totalCredit)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Journal */}
      <Card>
        <CardHeader>
          <CardTitle>General journal</CardTitle>
          <CardDescription>
            Every posted entry (append-only audit trail)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {journal.length === 0 && (
            <p className="text-sm text-muted-foreground">No entries in this period.</p>
          )}
          {journal.map((e) => (
            <div key={e.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">
                  {e.memo}{" "}
                  <Badge variant="outline" className="ml-1">
                    {e.source_type}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(e.entry_date).toLocaleString()}
                </div>
              </div>
              <Table>
                <TableBody>
                  {e.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{l.account}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.memo}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {l.debit ? kes(l.debit) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {l.credit ? kes(l.credit) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Period close + tip payout controls */}
      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
          <CardDescription>
            Lock a period after reporting, or pay pooled tips out to staff.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">
              Close books through
            </label>
            <Input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          <Button onClick={closePeriodNow}>Close period</Button>
          <Button variant="outline" onClick={reopenPeriodNow}>
            Reopen
          </Button>
          <div className="ml-auto">
            <Button variant="secondary" onClick={payoutTips}>
              Pay out tips
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <TableRow className={strong ? "font-bold" : ""}>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right font-mono">{value}</TableCell>
    </TableRow>
  );
}
