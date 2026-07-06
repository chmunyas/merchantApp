import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

export const Route = createFileRoute("/dashboard/settlement")({
  component: SettlementPage,
});

type SettlementSummary = {
  from: string;
  to: string;
  currency: "KES";
  gross: number;
  fees: number;
  net: number;
  txCount: number;
  reconciled: number;
  unreconciled: number;
};

type SettlementBatch = {
  id: string;
  period_start: string | null;
  period_end: string | null;
  gross: number;
  fees: number;
  net: number;
  tx_count: number;
  status: string;
  created_at: string;
};

const kes = (minor: number) =>
  `KES ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

function isoDaysAgo(n: number) {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

function SettlementPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  async function load(f = from, t = to) {
    if (!f || !t) return;
    setLoading(true);
    try {
      const [summaryRes, batchesRes] = await Promise.all([
        authFetch(`/api/settlement/summary?from=${f}&to=${t}`),
        authFetch("/api/settlement"),
      ]);
      setSummary(
        summaryRes.ok ? ((await summaryRes.json()) as SettlementSummary) : null,
      );
      setBatches(
        batchesRes.ok
          ? (((await batchesRes.json()) as { batches: SettlementBatch[] })
              .batches ?? [])
          : [],
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = new Date().toISOString().slice(0, 10);
    const f = isoDaysAgo(30);
    setFrom(f);
    setTo(t);
    void load(f, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSettlement() {
    if (!from || !to) return;
    setRunning(true);
    try {
      const res = await authFetch("/api/settlement/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        toast.error(res.status === 403 ? "Manager access required." : "Settlement failed.");
        return;
      }
      const data = (await res.json()) as { batch: SettlementBatch };
      toast.success(`Settlement created: ${kes(data.batch.net)} net.`);
      await load(from, to);
    } finally {
      setRunning(false);
    }
  }

  const reconciledTotal = (summary?.reconciled ?? 0) + (summary?.unreconciled ?? 0);
  const reconciledPct =
    reconciledTotal > 0
      ? Math.round(((summary?.reconciled ?? 0) / reconciledTotal) * 100)
      : 100;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Settlement & reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            Match succeeded payments into bank settlement batches and flag trust gaps.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => void load()}>
            {loading ? "…" : "Refresh"}
          </Button>
          <Button onClick={() => void runSettlement()} disabled={running}>
            {running ? "Settling…" : "Run settlement"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Gross", kes(summary?.gross ?? 0)],
          ["Fees", kes(summary?.fees ?? 0)],
          ["Net", kes(summary?.net ?? 0)],
          ["Transactions", String(summary?.txCount ?? 0)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation status</CardTitle>
          <CardDescription>
            {summary?.from ?? from} to {summary?.to ?? to}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${reconciledPct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">Reconciled {kes(summary?.reconciled ?? 0)}</Badge>
            <Badge variant={summary?.unreconciled ? "destructive" : "outline"}>
              Unreconciled {kes(summary?.unreconciled ?? 0)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Past settlement batches</CardTitle>
          <CardDescription>Newest first, scoped to this venue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell>{String(batch.created_at).slice(0, 10)}</TableCell>
                  <TableCell>
                    {String(batch.period_start ?? "").slice(0, 10)} →{" "}
                    {String(batch.period_end ?? "").slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right">{batch.tx_count}</TableCell>
                  <TableCell className="text-right">{kes(batch.gross)}</TableCell>
                  <TableCell className="text-right">{kes(batch.fees)}</TableCell>
                  <TableCell className="text-right font-medium">{kes(batch.net)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{batch.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    No settlement batches yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
