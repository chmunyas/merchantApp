import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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

export const Route = createFileRoute("/dashboard/payment-methods")({
  component: DashboardPaymentMethodsPage,
});

type MethodRow = {
  phone: string;
  name: string | null;
  tier: string | null;
  kind: "mpesa" | "card" | "wallet" | string;
  label: string;
  brand: string | null;
  last4: string | null;
  lastUsedAt: string | null;
};

type Payload = {
  methods: MethodRow[];
  counts: { mpesa: number; card: number; wallet: number };
  total: number;
};

const KIND_STYLE: Record<string, string> = {
  mpesa: "bg-emerald-100 text-emerald-700",
  card: "bg-indigo-100 text-indigo-700",
  wallet: "bg-slate-900 text-white",
};

function DashboardPaymentMethodsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/payment-methods");
        if (res.ok) {
          setData((await res.json()) as Payload);
        } else {
          toast.error("Couldn't load payment methods");
        }
      } catch {
        toast.error("Couldn't load payment methods");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Group methods per customer (phone).
  const customers = useMemo(() => {
    const map = new Map<
      string,
      { phone: string; name: string | null; tier: string | null; methods: MethodRow[] }
    >();
    for (const m of data?.methods ?? []) {
      if (!map.has(m.phone)) {
        map.set(m.phone, {
          phone: m.phone,
          name: m.name,
          tier: m.tier,
          methods: [],
        });
      }
      map.get(m.phone)!.methods.push(m);
    }
    return [...map.values()];
  }, [data]);

  function maskPhone(p: string): string {
    return p.length > 6 ? `${p.slice(0, 5)}•••${p.slice(-3)}` : p;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Customer payment methods
        </h1>
        <p className="text-sm text-slate-500">
          What your customers have on file — M-Pesa numbers and tokenised cards /
          wallets (Apple Pay, Google Pay). Card details are never stored (SAQ-A) —
          only a brand + last-4 for display.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !data || data.total === 0 ? (
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            No saved methods yet. They appear here after customers pay (M-Pesa
            numbers are remembered; cards/wallets are saved via the hosted
            checkout once live PesaSwap is enabled).
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Customers", customers.length],
              ["M-Pesa", data.counts.mpesa],
              ["Cards", data.counts.card],
              ["Wallets", data.counts.wallet],
            ].map(([label, n]) => (
              <div
                key={label}
                className="rounded-2xl border border-slate-200 bg-white/90 p-3 text-center shadow-sm"
              >
                <p className="text-2xl font-semibold text-slate-900">{n}</p>
                <p className="mt-1 text-xs font-medium text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>On file</CardTitle>
              <CardDescription>
                Grouped by customer, most recently used first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-2">Customer</th>
                      <th className="pr-2">Phone</th>
                      <th>Methods</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.phone} className="border-t border-slate-100">
                        <td className="py-2 pr-2">
                          <span className="font-medium text-slate-800">
                            {c.name ?? "Guest"}
                          </span>
                          {c.tier ? (
                            <span className="ml-1 text-xs text-slate-400">
                              {c.tier}
                            </span>
                          ) : null}
                        </td>
                        <td className="pr-2 font-mono text-slate-500">
                          {maskPhone(c.phone)}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {c.methods.map((m, i) => (
                              <Badge
                                key={`${m.kind}-${i}`}
                                className={
                                  KIND_STYLE[m.kind] ?? "bg-slate-100 text-slate-600"
                                }
                              >
                                {m.label}
                              </Badge>
                            ))}
                          </div>
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
