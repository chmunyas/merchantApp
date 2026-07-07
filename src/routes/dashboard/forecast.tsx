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
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/forecast")({
  component: DashboardForecastPage,
});

type Busiest = {
  dow: number;
  hour: number;
  weekday: string;
  label: string;
  avgOrders: number;
  avgUnits: number;
};

type OutlookDay = {
  date: string;
  weekday: string;
  predictedOrders: number;
  predictedUnits: number;
};

type PrepLine = {
  name: string;
  recommended: number;
  avgUnits: number;
  lastUnits: number;
  confidence: "high" | "medium" | "low";
};

type Forecast = {
  timezone: string;
  windowDays: number;
  demand: {
    busiest: Busiest[];
    outlook: OutlookDay[];
  };
  prep: {
    date: string;
    weekday: string;
    bufferPct: number;
    lines: PrepLine[];
  };
};

const CONF_STYLE = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
} as const;

function DashboardForecastPage() {
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");

  async function load(target?: string) {
    setLoading(true);
    try {
      const q = target ? `?date=${encodeURIComponent(target)}` : "";
      const res = await authFetch(`/api/forecast${q}`);
      if (res.ok) {
        setData((await res.json()) as Forecast);
      } else {
        toast.error("Couldn't load the forecast");
      }
    } catch {
      toast.error("Couldn't load the forecast");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const maxOutlook = data
    ? Math.max(1, ...data.demand.outlook.map((o) => o.predictedOrders))
    : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Demand forecast &amp; smart prep
        </h1>
        <p className="text-sm text-slate-500">
          Busy periods and recommended prep quantities from your recent sales
          {data ? ` (${data.timezone} time, last ${data.windowDays} days)` : ""}.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Crunching your sales history…</p>
      ) : !data ? (
        <Button onClick={() => void load()}>Load forecast</Button>
      ) : data.demand.busiest.length === 0 && data.prep.lines.length === 0 ? (
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            Not enough sales history yet. Once orders start flowing, this page
            will predict your busy periods and prep quantities.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>Busiest windows</CardTitle>
              <CardDescription>
                When orders peak, averaged across recent weeks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.demand.busiest.length === 0 ? (
                <p className="text-sm text-slate-500">No peaks yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.demand.busiest.map((s) => (
                    <div
                      key={`${s.dow}-${s.hour}`}
                      className="rounded-2xl border border-slate-200 px-4 py-2"
                    >
                      <p className="text-sm font-medium text-slate-800">
                        {s.label}
                      </p>
                      <p className="text-xs text-slate-500">
                        ~{s.avgOrders} orders · {s.avgUnits} items
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>Next {data.demand.outlook.length} days</CardTitle>
              <CardDescription>
                Predicted order volume by day, from each weekday's pattern.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.demand.outlook.map((o) => (
                  <div key={o.date} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 text-sm text-slate-600">
                      {o.weekday}
                      <span className="ml-1 text-xs text-slate-400">
                        {o.date.slice(5)}
                      </span>
                    </div>
                    <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{
                          width: `${Math.round(
                            (o.predictedOrders / maxOutlook) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-700">
                      {o.predictedOrders} orders
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardTitle>Smart prep — {data.prep.weekday}</CardTitle>
                  <CardDescription>
                    Recommended quantities for {data.prep.date} (includes a{" "}
                    {Math.round(data.prep.bufferPct * 100)}% safety buffer).
                  </CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">
                      Plan for date
                    </label>
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void load(date || undefined)}
                  >
                    Update
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {data.prep.lines.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No sales recorded for a {data.prep.weekday} yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-500">
                        <th className="py-2 pr-2">Item</th>
                        <th className="pr-2 text-right">Prep</th>
                        <th className="pr-2 text-right">Avg</th>
                        <th className="pr-2 text-right">Last</th>
                        <th>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.prep.lines.map((l) => (
                        <tr
                          key={l.name}
                          className="border-t border-slate-100"
                        >
                          <td className="py-2 pr-2 font-medium text-slate-800">
                            {l.name}
                          </td>
                          <td className="pr-2 text-right font-semibold tabular-nums text-slate-900">
                            {l.recommended}
                          </td>
                          <td className="pr-2 text-right tabular-nums text-slate-500">
                            {l.avgUnits}
                          </td>
                          <td className="pr-2 text-right tabular-nums text-slate-500">
                            {l.lastUnits}
                          </td>
                          <td>
                            <Badge className={CONF_STYLE[l.confidence]}>
                              {l.confidence}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
