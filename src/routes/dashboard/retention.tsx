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

export const Route = createFileRoute("/dashboard/retention")({
  component: DashboardRetentionPage,
});

type Segment =
  | "Champions"
  | "Loyal"
  | "Promising"
  | "At risk"
  | "Lost"
  | "Needs attention";

type ScoredCustomer = {
  ref: string;
  name: string;
  tier: string;
  recencyDays: number;
  frequency: number;
  monetary: number;
  segment: Segment;
  churnRisk: "high" | "medium" | "low";
  avgOrderValue: number;
  predictedAnnualValue: number;
};

type Rfm = {
  currency: string;
  totalCustomers: number;
  totalMonetary: number;
  segments: Record<Segment, number>;
  customers: ScoredCustomer[];
  atRisk: ScoredCustomer[];
};

const SEGMENT_ORDER: Segment[] = [
  "Champions",
  "Loyal",
  "Promising",
  "At risk",
  "Lost",
  "Needs attention",
];

const SEGMENT_STYLE: Record<Segment, string> = {
  Champions: "bg-emerald-100 text-emerald-700",
  Loyal: "bg-sky-100 text-sky-700",
  Promising: "bg-indigo-100 text-indigo-700",
  "At risk": "bg-amber-100 text-amber-700",
  Lost: "bg-rose-100 text-rose-700",
  "Needs attention": "bg-slate-100 text-slate-600",
};

const CHURN_STYLE = {
  high: "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
} as const;

function DashboardRetentionPage() {
  const [data, setData] = useState<Rfm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/customers/rfm");
        if (res.ok) {
          setData((await res.json()) as Rfm);
        } else {
          toast.error("Couldn't load customer insights");
        }
      } catch {
        toast.error("Couldn't load customer insights");
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
          Customer retention
        </h1>
        <p className="text-sm text-slate-500">
          RFM segments, churn risk and lifetime value from your payment history —
          so you know who to keep, grow and win back.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Segmenting your customers…</p>
      ) : !data ? null : data.totalCustomers === 0 ? (
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            No identified customers yet. Once payments are linked to a phone
            (loyalty, QR or portal), segments appear here.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {SEGMENT_ORDER.map((seg) => (
              <div
                key={seg}
                className="rounded-2xl border border-slate-200 bg-white/90 p-3 text-center shadow-sm"
              >
                <p className="text-2xl font-semibold text-slate-900">
                  {data.segments[seg] ?? 0}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">{seg}</p>
              </div>
            ))}
          </div>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>Win-back targets</CardTitle>
              <CardDescription>
                Customers who are slipping away, highest value first — the best
                use of a retention offer. Total tracked spend: {currency}{" "}
                {data.totalMonetary.toLocaleString()}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.atRisk.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No one's slipping right now — nice work.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-500">
                        <th className="py-2 pr-2">Customer</th>
                        <th className="pr-2">Risk</th>
                        <th className="pr-2 text-right">Spent</th>
                        <th className="pr-2 text-right">Last seen</th>
                        <th className="text-right">Est. value/yr</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.atRisk.map((c) => (
                        <tr
                          key={c.ref}
                          className="border-t border-slate-100"
                        >
                          <td className="py-2 pr-2">
                            <span className="font-medium text-slate-800">
                              {c.name}
                            </span>
                            <span className="ml-1 text-xs text-slate-400">
                              {c.tier}
                            </span>
                          </td>
                          <td className="pr-2">
                            <Badge className={CHURN_STYLE[c.churnRisk]}>
                              {c.churnRisk}
                            </Badge>
                          </td>
                          <td className="pr-2 text-right tabular-nums">
                            {currency} {c.monetary.toLocaleString()}
                          </td>
                          <td className="pr-2 text-right tabular-nums text-slate-500">
                            {c.recencyDays}d ago
                          </td>
                          <td className="text-right tabular-nums text-slate-700">
                            {currency} {c.predictedAnnualValue.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>Most valuable customers</CardTitle>
              <CardDescription>
                Your top spenders — protect and grow these relationships.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-2">Customer</th>
                      <th className="pr-2">Segment</th>
                      <th className="pr-2 text-right">Orders</th>
                      <th className="pr-2 text-right">Avg</th>
                      <th className="text-right">Spent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.slice(0, 15).map((c) => (
                      <tr key={c.ref} className="border-t border-slate-100">
                        <td className="py-2 pr-2 font-medium text-slate-800">
                          {c.name}
                        </td>
                        <td className="pr-2">
                          <Badge className={SEGMENT_STYLE[c.segment]}>
                            {c.segment}
                          </Badge>
                        </td>
                        <td className="pr-2 text-right tabular-nums text-slate-500">
                          {c.frequency}
                        </td>
                        <td className="pr-2 text-right tabular-nums text-slate-500">
                          {currency} {c.avgOrderValue.toLocaleString()}
                        </td>
                        <td className="text-right tabular-nums font-semibold text-slate-900">
                          {currency} {c.monetary.toLocaleString()}
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
