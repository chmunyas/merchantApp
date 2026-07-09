import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Loader2, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { chainRollup, type ChainStore } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/chain")({
  component: DashboardChainPage,
});

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

type Rollup = {
  currency: string;
  stores: ChainStore[];
  total: Omit<ChainStore, "id" | "name">;
};

function DashboardChainPage() {
  const [data, setData] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await chainRollup();
      setData(res);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chain</h1>
        <p className="text-sm text-muted-foreground">
          Net revenue across every store you own or manage (last 30 days).
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading rollup…
        </div>
      ) : !data || data.stores.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You don&apos;t manage more than one store yet. Add a store from the
            venue picker to see a cross-store rollup here.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Net revenue"
              value={currency.format(data.total.net / 100)}
              accent
            />
            <StatCard
              label="Gross"
              value={currency.format(data.total.gross / 100)}
            />
            <StatCard
              label="Refunds"
              value={currency.format(data.total.refunds / 100)}
            />
            <StatCard label="Transactions" value={String(data.total.txns)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4" /> Stores ({data.stores.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {data.stores.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.txns} txns · tips {currency.format(s.tips / 100)}
                      {s.refunds > 0
                        ? ` · refunds ${currency.format(s.refunds / 100)}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {currency.format(s.net / 100)}
                    </p>
                    <Badge variant="secondary" className="mt-0.5">
                      <TrendingUp className="mr-1 size-3" /> net
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-accent" : undefined}>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
