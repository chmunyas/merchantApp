import { createFileRoute } from "@tanstack/react-router";
import { Download, Printer } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authFetch, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/reports")({
  component: ReportsPage,
});

type Summary = {
  from: string;
  to: string;
  currency: string;
  totals: { tx: number; gross: number; tips: number };
  byItem: Array<{ name: string; qty: number; amount: number }>;
  byDay: Array<{ day: string; tx: number; amount: number }>;
};

const kes = (minor: number) =>
  `KES ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

function isoDaysAgo(n: number) {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

function ReportsPage() {
  const { user } = useAuth();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(f = from, t = to) {
    if (!f || !t) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/reports/summary?from=${f}&to=${t}`);
      setData(res.ok ? ((await res.json()) as Summary) : null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Compute the default range on the client only, to keep SSR + first client
    // render identical (avoids a hydration mismatch on the date fields).
    const t = new Date().toISOString().slice(0, 10);
    const f = isoDaysAgo(30);
    setFrom(f);
    setTo(t);
    void load(f, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function downloadCsv() {
    if (!data) return;
    const rows: string[] = [
      `PesaSwap notebook — ${user?.name ?? "Merchant"}`,
      `Period,${data.from},${data.to}`,
      "",
      `Transactions,${data.totals.tx}`,
      `Gross (minor units),${data.totals.gross}`,
      `Tips (minor units),${data.totals.tips}`,
      "",
      "Item,Qty,Amount (minor units)",
      ...data.byItem.map((i) => `${JSON.stringify(i.name)},${i.qty},${i.amount}`),
      "",
      "Day,Transactions,Amount (minor units)",
      ...data.byDay.map((d) => `${d.day},${d.tx},${d.amount}`),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `notebook-${data.from}_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Notebook</h1>
          <p className="text-sm text-muted-foreground">
            Your sales for a period — download it, no POS required.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => void load()}>
            {loading ? "…" : "Run"}
          </Button>
        </div>
      </div>

      <div className="flex gap-2 print:hidden">
        <Button onClick={downloadCsv} disabled={!data} className="gap-2">
          <Download className="size-4" /> CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => window.print()}
          disabled={!data}
          className="gap-2"
        >
          <Printer className="size-4" /> Print / Save as PDF
        </Button>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : "No data for this period."}
        </p>
      ) : (
        <div className="space-y-6 rounded-2xl border border-border bg-card p-6">
          <header>
            <h2 className="text-lg font-semibold">
              {user?.name ?? "Merchant"} — transaction notebook
            </h2>
            <p className="text-sm text-muted-foreground">
              {data.from} to {data.to}
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase text-muted-foreground">Sales</p>
              <p className="text-2xl font-bold">{kes(data.totals.gross)}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase text-muted-foreground">
                Transactions
              </p>
              <p className="text-2xl font-bold">{data.totals.tx}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase text-muted-foreground">Tips</p>
              <p className="text-2xl font-bold">{kes(data.totals.tips)}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Items</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Item</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.byItem.map((i) => (
                  <tr key={i.name} className="border-t border-border">
                    <td className="py-1">{i.name}</td>
                    <td className="text-right">{i.qty}</td>
                    <td className="text-right">{kes(i.amount)}</td>
                  </tr>
                ))}
                {data.byItem.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-2 text-muted-foreground">
                      No itemised orders in this period (totals above still apply).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">By day</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Day</th>
                  <th className="text-right">Transactions</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.byDay.map((d) => (
                  <tr key={String(d.day)} className="border-t border-border">
                    <td className="py-1">{String(d.day).slice(0, 10)}</td>
                    <td className="text-right">{d.tx}</td>
                    <td className="text-right">{kes(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
