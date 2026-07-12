import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authFetch } from "@/lib/auth";
import {
  DEFAULT_FEE_SCHEDULE,
  INSTANT_PAYOUT_PERCENT,
  computeFee,
  type PayMethod,
} from "@/lib/fees";

export const Route = createFileRoute("/dashboard/fees")({
  component: FeesPage,
});

type MethodRow = {
  method: string;
  label: string;
  publishedPercent: number;
  volume: number;
  fees: number;
  count: number;
  rate: number;
};
type DayRow = { date: string; gross: number; fees: number; net: number };
type FeeSummary = {
  days: number;
  currency: string;
  gross: number;
  fees: number;
  net: number;
  effectiveRate: number;
  count: number;
  methods: MethodRow[];
  daily: DayRow[];
};

const kes = (minor: number) =>
  `KES ${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const kes2 = (minor: number) =>
  `KES ${(minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const pct = (n: number) => `${n.toFixed(2)}%`;

function FeesPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authFetch(`/api/fees/summary?days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setSummary(d as FeeSummary);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Live fee calculator (client-side, from the same shared schedule the ledger
  // uses) — the merchant can see the real cost of any sale before taking it.
  const [calcAmount, setCalcAmount] = useState("1000");
  const [calcMethod, setCalcMethod] = useState<PayMethod>("mpesa");
  const [instant, setInstant] = useState(false);
  const quote = useMemo(() => {
    const minor = Math.round((Number(calcAmount) || 0) * 100);
    return computeFee(minor, calcMethod, { instantPayout: instant });
  }, [calcAmount, calcMethod, instant]);

  const recentDaily = (summary?.daily ?? []).slice(-7).reverse();

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fees & takings</h1>
          <p className="text-sm text-muted-foreground">
            The real blended rate you pay — no hidden surcharges, no bill shock.
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </header>

      {/* Headline: blended effective rate + gross/fees/net */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Blended effective rate (last {days} days)</CardDescription>
          <CardTitle className="text-4xl font-mono">
            {loading ? "—" : pct(summary?.effectiveRate ?? 0)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t">
            <Stat label="Gross taken" value={kes(summary?.gross ?? 0)} />
            <Stat label="Fees paid" value={kes2(summary?.fees ?? 0)} tone="text-amber-600" />
            <Stat label="Net kept" value={kes(summary?.net ?? 0)} tone="text-emerald-600" />
            <Stat label="Sales" value={String(summary?.count ?? 0)} />
          </div>
          {!loading && (summary?.count ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground mt-4">
              No settled sales in this window yet. Take a payment to see your real
              effective rate here.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Per-method breakdown — where the blended rate actually comes from */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By payment method</CardTitle>
          <CardDescription>
            Your headline rate is a blend — premium cards and instant payouts cost
            more, Pay-by-Bank costs less.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">Published</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Effective</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(summary?.methods ?? []).map((m) => (
                <TableRow key={m.method}>
                  <TableCell className="font-medium">{m.label}</TableCell>
                  <TableCell className="text-right font-mono">
                    {kes(m.volume)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {pct(m.publishedPercent)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {kes2(m.fees)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {pct(m.rate)}
                  </TableCell>
                </TableRow>
              ))}
              {(summary?.methods ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No data yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Daily takings — gross vs fees vs net */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily takings</CardTitle>
            <CardDescription>Gross, fees and what you kept.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDaily.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="font-mono text-xs">{d.date}</TableCell>
                    <TableCell className="text-right font-mono">{kes(d.gross)}</TableCell>
                    <TableCell className="text-right font-mono text-amber-600">
                      {kes2(d.fees)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-600">
                      {kes(d.net)}
                    </TableCell>
                  </TableRow>
                ))}
                {recentDaily.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No sales yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Live fee calculator — no bill shock, know the cost before you charge */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fee calculator</CardTitle>
            <CardDescription>
              See exactly what you receive for any sale.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Sale amount (KES)
              </label>
              <Input
                type="number"
                inputMode="numeric"
                value={calcAmount}
                onChange={(e) => setCalcAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="mt-1 font-mono text-lg"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_FEE_SCHEDULE.filter((t) => t.method !== "other").map((t) => (
                <Button
                  key={t.method}
                  size="sm"
                  variant={calcMethod === t.method ? "default" : "outline"}
                  onClick={() => setCalcMethod(t.method)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={instant}
                onChange={(e) => setInstant(e.target.checked)}
              />
              Instant payout (+{INSTANT_PAYOUT_PERCENT}% surcharge)
            </label>
            <div className="rounded-xl border bg-muted/40 p-4 space-y-1.5">
              <Row label="Sale" value={kes2(Math.round((Number(calcAmount) || 0) * 100))} />
              <Row label={`Fee (${pct(quote.rate)})`} value={`− ${kes2(quote.fee)}`} tone="text-amber-600" />
              <div className="flex justify-between border-t pt-1.5 font-semibold">
                <span>You receive</span>
                <span className="font-mono text-emerald-700">{kes2(quote.net)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={`text-lg font-bold font-mono ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${tone ?? ""}`}>{value}</span>
    </div>
  );
}
