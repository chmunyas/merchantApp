import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/reorder")({
  component: DashboardReorderPage,
});

type Status = "critical" | "low" | "ok" | "overstocked";

type ReorderLine = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  supplier: string | null;
  stock: number;
  dailyVelocity: number;
  daysLeft: number | null;
  status: Status;
  suggestedQty: number;
  cost: number;
  lineCost: number;
  reason: string;
};

type SupplierOrder = {
  supplier: string;
  lines: ReorderLine[];
  totalCost: number;
};

type ReorderPlan = {
  currency: string;
  leadTimeDays: number;
  coverDays: number;
  lines: ReorderLine[];
  toOrder: ReorderLine[];
  bySupplier: SupplierOrder[];
  totalReorderCost: number;
  counts: Record<Status, number>;
};

const STATUS_ORDER: Status[] = ["critical", "low", "ok", "overstocked"];

const STATUS_STYLE: Record<Status, string> = {
  critical: "bg-rose-100 text-rose-700",
  low: "bg-amber-100 text-amber-700",
  ok: "bg-emerald-100 text-emerald-700",
  overstocked: "bg-sky-100 text-sky-700",
};

function DashboardReorderPage() {
  const [data, setData] = useState<ReorderPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/inventory/reorder");
        if (res.ok) {
          setData((await res.json()) as ReorderPlan);
        } else {
          toast.error("Couldn't load the reorder plan");
        }
      } catch {
        toast.error("Couldn't load the reorder plan");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currency = data?.currency ?? "KES";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Inventory reorder
        </h1>
        <p className="text-sm text-slate-500">
          Predicted stockouts from your consumption rate, with draft purchase
          orders grouped by supplier. Review, then order.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Checking stock against demand…</p>
      ) : !data ? null : data.lines.length === 0 ? (
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            No inventory items yet. Add stock items (with cost + supplier) to get
            reorder suggestions.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {STATUS_ORDER.map((s) => (
              <div
                key={s}
                className="rounded-2xl border border-slate-200 bg-white/90 p-3 text-center shadow-sm"
              >
                <p className="text-2xl font-semibold text-slate-900">
                  {data.counts[s] ?? 0}
                </p>
                <p className="mt-1 text-xs font-medium capitalize text-slate-500">
                  {s}
                </p>
              </div>
            ))}
          </div>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>
                Draft purchase orders — {currency}{" "}
                {data.totalReorderCost.toLocaleString()}
              </CardTitle>
              <CardDescription>
                Covers the {data.leadTimeDays}-day lead time plus {data.coverDays}{" "}
                days of stock. Quantities top up to that target.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.bySupplier.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Nothing needs reordering right now.
                </p>
              ) : (
                data.bySupplier.map((po) => (
                  <div
                    key={po.supplier}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-medium text-slate-800">{po.supplier}</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {currency} {po.totalCost.toLocaleString()}
                      </p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-slate-500">
                          <th className="py-1 pr-2">Item</th>
                          <th className="pr-2 text-right">Order</th>
                          <th className="pr-2 text-right">Unit</th>
                          <th className="text-right">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {po.lines.map((l) => (
                          <tr key={l.id} className="border-t border-slate-100">
                            <td className="py-1 pr-2">
                              <span className="font-medium text-slate-800">
                                {l.name}
                              </span>
                              <Badge
                                className={`ml-2 ${STATUS_STYLE[l.status]}`}
                              >
                                {l.status}
                              </Badge>
                            </td>
                            <td className="pr-2 text-right tabular-nums">
                              {l.suggestedQty} {l.unit}
                            </td>
                            <td className="pr-2 text-right tabular-nums text-slate-500">
                              {currency} {l.cost.toLocaleString()}
                            </td>
                            <td className="text-right tabular-nums font-medium text-slate-900">
                              {currency} {l.lineCost.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>All stock</CardTitle>
              <CardDescription>
                Days of cover left at the current consumption rate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-2">Item</th>
                      <th className="pr-2">Status</th>
                      <th className="pr-2 text-right">Stock</th>
                      <th className="pr-2 text-right">Sold/day</th>
                      <th className="text-right">Days left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="py-2 pr-2 font-medium text-slate-800">
                          {l.name}
                        </td>
                        <td className="pr-2">
                          <Badge className={STATUS_STYLE[l.status]}>
                            {l.status}
                          </Badge>
                        </td>
                        <td className="pr-2 text-right tabular-nums">
                          {l.stock} {l.unit}
                        </td>
                        <td className="pr-2 text-right tabular-nums text-slate-500">
                          {l.dailyVelocity}
                        </td>
                        <td className="text-right tabular-nums text-slate-700">
                          {l.daysLeft === null ? "—" : `${l.daysLeft}d`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
