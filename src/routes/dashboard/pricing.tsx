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
import { authFetch, hasAuthoritativeVenueSession } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/pricing")({
  component: DashboardPricingPage,
});

type Suggestion = {
  name: string;
  category: string;
  action: "raise" | "promote" | "remove" | "hold";
  currentPrice: number;
  suggestedPrice: number;
  changePct: number;
  weeklyImpact: number;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

type HappyHour = {
  dow: number;
  weekday: string;
  startHour: number;
  endHour: number;
  avgOrders: number;
  label: string;
};

type Pricing = {
  currency: string;
  windowDays: number;
  pricing: {
    suggestions: Suggestion[];
    totalWeeklyUpside: number;
    counts: Record<"raise" | "promote" | "remove" | "hold", number>;
  };
  happyHours: HappyHour[];
};

const ACTION_STYLE = {
  raise: "bg-emerald-100 text-emerald-700",
  promote: "bg-sky-100 text-sky-700",
  remove: "bg-rose-100 text-rose-700",
  hold: "bg-slate-100 text-slate-600",
} as const;

const CONF_STYLE = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
} as const;

function DashboardPricingPage() {
  const [data, setData] = useState<Pricing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      if (!hasAuthoritativeVenueSession()) {
        setLoading(false);
        return;
      }
      try {
        const res = await authFetch("/api/pricing");
        if (res.ok) {
          setData((await res.json()) as Pricing);
        } else {
          toast.error("Couldn't load pricing suggestions");
        }
      } catch {
        toast.error("Couldn't load pricing suggestions");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currency = data?.currency ?? "KES";
  const actionable =
    data?.pricing.suggestions.filter(
      (s) => s.action === "raise" || s.action === "promote",
    ) ?? [];
  const reviewable =
    data?.pricing.suggestions.filter((s) => s.action === "remove") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Smart pricing
        </h1>
        <p className="text-sm text-slate-500">
          Time-of-day and menu-engineering pricing moves from your recent sales
          and margins. Suggestions only — nothing changes until you apply it.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Weighing demand against margins…</p>
      ) : !data ? null : data.pricing.suggestions.length === 0 ? (
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            Add menu items (with linked inventory costs) and take a few orders to
            unlock pricing suggestions.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>
                Estimated upside: {currency}{" "}
                {data.pricing.totalWeeklyUpside.toLocaleString()} / week
              </CardTitle>
              <CardDescription>
                {data.pricing.counts.raise} price rise
                {data.pricing.counts.raise === 1 ? "" : "s"} ·{" "}
                {data.pricing.counts.promote} to promote ·{" "}
                {data.pricing.counts.remove} to review. If volumes hold.
              </CardDescription>
            </CardHeader>
          </Card>

          {data.happyHours.length > 0 ? (
            <Card className="border-slate-200 bg-white/90 shadow-sm">
              <CardHeader>
                <CardTitle>Happy-hour windows</CardTitle>
                <CardDescription>
                  Your quietest trading hours — run a discount here to fill seats
                  instead of discounting demand you already have.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {data.happyHours.map((h) => (
                    <div
                      key={`${h.dow}-${h.startHour}`}
                      className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-800"
                    >
                      {h.label}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>Price moves</CardTitle>
              <CardDescription>
                Raise popular low-margin items, promote hidden gems.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {actionable.length === 0 ? (
                <p className="text-sm text-slate-500">No moves to suggest yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-slate-500">
                        <th className="py-2 pr-2">Item</th>
                        <th className="pr-2">Action</th>
                        <th className="pr-2 text-right">Price</th>
                        <th className="pr-2 text-right">+/wk</th>
                        <th className="pr-2">Confidence</th>
                        <th>Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionable.map((s) => (
                        <tr
                          key={s.name}
                          className="border-t border-slate-100 align-top"
                        >
                          <td className="py-2 pr-2 font-medium text-slate-800">
                            {s.name}
                          </td>
                          <td className="pr-2">
                            <Badge className={ACTION_STYLE[s.action]}>
                              {s.action}
                            </Badge>
                          </td>
                          <td className="pr-2 text-right tabular-nums">
                            {s.action === "raise" ? (
                              <span>
                                <span className="text-slate-400 line-through">
                                  {s.currentPrice.toLocaleString()}
                                </span>{" "}
                                <span className="font-semibold text-slate-900">
                                  {s.suggestedPrice.toLocaleString()}
                                </span>
                              </span>
                            ) : (
                              <span className="text-slate-500">
                                {s.currentPrice.toLocaleString()}
                              </span>
                            )}
                          </td>
                          <td className="pr-2 text-right tabular-nums text-emerald-700">
                            {s.weeklyImpact > 0
                              ? `+${s.weeklyImpact.toLocaleString()}`
                              : "—"}
                          </td>
                          <td className="pr-2">
                            <Badge className={CONF_STYLE[s.confidence]}>
                              {s.confidence}
                            </Badge>
                          </td>
                          <td className="max-w-sm text-slate-600">
                            {s.rationale}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {reviewable.length > 0 ? (
            <Card className="border-slate-200 bg-white/90 shadow-sm">
              <CardHeader>
                <CardTitle>Consider retiring</CardTitle>
                <CardDescription>
                  Low demand and low margin — candidates to rework or remove.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {reviewable.map((s) => (
                    <Badge
                      key={s.name}
                      variant="outline"
                      className="border-rose-200 text-rose-600"
                    >
                      {s.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
