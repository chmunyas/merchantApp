import { createFileRoute } from "@tanstack/react-router";
import { format, startOfWeek, subDays } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ensureMerchantDemoData,
  flattenTransactions,
  loadMerchantSnapshot,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";
import { AgentAnalyticsCard } from "@/components/omni/AgentAnalyticsCard";

export const Route = createFileRoute("/dashboard/analytics")({
  component: DashboardAnalyticsPage,
});

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

type RangePreset = "7d" | "30d" | "90d";
type Granularity = "day" | "week" | "month";
type ChartMode = "line" | "bar";

function generateDemoData() {
  return ensureMerchantDemoData();
}

function DashboardAnalyticsPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [chartMode, setChartMode] = useState<ChartMode>("line");

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
  }, []);

  const analytics = useMemo(() => {
    if (!snapshot) return null;

    const rangeDays =
      rangePreset === "7d" ? 7 : rangePreset === "30d" ? 30 : 90;
    const since = subDays(new Date(), rangeDays);
    const transactions = flattenTransactions(snapshot.tables).filter(
      (transaction) =>
        transaction.status !== "failed" &&
        new Date(transaction.createdAt) >= since,
    );

    const bucketCount =
      granularity === "day"
        ? Math.min(rangeDays, 12)
        : granularity === "week"
          ? 8
          : 3;
    const revenueSeries = Array.from({ length: bucketCount }).map(
      (_, index) => {
        const daysPerBucket =
          granularity === "day"
            ? Math.ceil(rangeDays / bucketCount)
            : granularity === "week"
              ? 7
              : 30;
        const bucketStart = subDays(
          new Date(),
          daysPerBucket * (bucketCount - index - 1),
        );
        const bucketEnd = subDays(
          new Date(),
          daysPerBucket * (bucketCount - index - 2),
        );
        const current = transactions
          .filter((transaction) => {
            const createdAt = new Date(transaction.createdAt);
            return createdAt >= bucketStart && createdAt < bucketEnd;
          })
          .reduce(
            (sum, transaction) =>
              sum +
              (transaction.status === "refunded"
                ? -transaction.amount
                : transaction.amount + transaction.tip),
            0,
          );
        const previousStart = subDays(bucketStart, daysPerBucket);
        const previous = transactions
          .filter((transaction) => {
            const createdAt = new Date(transaction.createdAt);
            return createdAt >= previousStart && createdAt < bucketStart;
          })
          .reduce(
            (sum, transaction) =>
              sum +
              (transaction.status === "refunded"
                ? -transaction.amount
                : transaction.amount + transaction.tip),
            0,
          );

        return {
          label:
            granularity === "day"
              ? format(bucketStart, "dd MMM")
              : granularity === "week"
                ? `Wk ${format(startOfWeek(bucketStart, { weekStartsOn: 1 }), "dd MMM")}`
                : format(bucketStart, "MMM"),
          current,
          previous,
        };
      },
    );

    const paymentMethodData = ["M-Pesa", "Card", "Split", "Cash"].map(
      (method) => ({
        name: method,
        value: transactions
          .filter((transaction) => transaction.method === method)
          .reduce((sum, transaction) => sum + transaction.amount, 0),
      }),
    );

    const heatmap = Array.from({ length: 7 }).map((_, dayIndex) =>
      Array.from({ length: 24 }).map((__, hour) => {
        const hits = transactions.filter((transaction) => {
          const createdAt = new Date(transaction.createdAt);
          return (
            createdAt.getDay() === dayIndex && createdAt.getHours() === hour
          );
        }).length;
        return hits;
      }),
    );

    const visitCounts = transactions.reduce<Record<string, number>>(
      (acc, transaction) => {
        acc[transaction.phone] = (acc[transaction.phone] || 0) + 1;
        return acc;
      },
      {},
    );

    const newCustomers = Object.values(visitCounts).filter(
      (count) => count === 1,
    ).length;
    const returningCustomers = Object.values(visitCounts).filter(
      (count) => count > 1,
    ).length;
    const loyaltyBreakdown = [
      {
        tier: "Bronze",
        value: Object.values(visitCounts).filter((count) => count <= 1).length,
      },
      {
        tier: "Silver",
        value: Object.values(visitCounts).filter((count) => count === 2).length,
      },
      {
        tier: "Gold",
        value: Object.values(visitCounts).filter(
          (count) => count >= 3 && count < 5,
        ).length,
      },
      {
        tier: "Platinum",
        value: Object.values(visitCounts).filter((count) => count >= 5).length,
      },
    ];

    const turnTimeDistribution = [
      { label: "< 30m", value: 0 },
      { label: "30-45m", value: 0 },
      { label: "45-60m", value: 0 },
      { label: "60m+", value: 0 },
    ];

    snapshot.orders.forEach((order) => {
      if (!order.servedAt) return;
      const minutes =
        (new Date(order.servedAt).getTime() -
          new Date(order.orderedAt).getTime()) /
        60_000;
      if (minutes < 30) turnTimeDistribution[0].value += 1;
      else if (minutes < 45) turnTimeDistribution[1].value += 1;
      else if (minutes < 60) turnTimeDistribution[2].value += 1;
      else turnTimeDistribution[3].value += 1;
    });

    const avgTicketByDay = [
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
    ].map((label, dayIndex) => {
      const dayTransactions = transactions.filter(
        (transaction) => new Date(transaction.createdAt).getDay() === dayIndex,
      );
      const average = dayTransactions.length
        ? dayTransactions.reduce(
            (sum, transaction) => sum + transaction.amount + transaction.tip,
            0,
          ) / dayTransactions.length
        : 0;
      return { label, average };
    });

    return {
      revenueSeries,
      paymentMethodData,
      heatmap,
      segments: { newCustomers, returningCustomers, loyaltyBreakdown },
      turnTimeDistribution,
      avgTicketByDay,
    };
  }, [snapshot, rangePreset, granularity]);

  if (!snapshot || !analytics) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading analytics…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-2xl font-semibold">Operational analytics</h3>
          <p className="text-sm text-muted-foreground">
            Revenue patterns, customer segments, and service efficiency.          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={rangePreset}
            onChange={(event) =>
              setRangePreset(event.target.value as RangePreset)
            }
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <select
            value={granularity}
            onChange={(event) =>
              setGranularity(event.target.value as Granularity)
            }
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="day">By day</option>
            <option value="week">By week</option>
            <option value="month">By month</option>
          </select>
          <select
            value={chartMode}
            onChange={(event) => setChartMode(event.target.value as ChartMode)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="line">Line</option>
            <option value="bar">Bar</option>
          </select>
        </div>
      </div>

      <AgentAnalyticsCard />

      <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Revenue vs previous period</h3>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === "line" ? (
                <LineChart data={analytics.revenueSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis
                    tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => currency.format(value)}
                  />
                  <Line
                    dataKey="current"
                    type="monotone"
                    stroke="#10b981"
                    strokeWidth={3}
                  />
                  <Line
                    dataKey="previous"
                    type="monotone"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                </LineChart>
              ) : (
                <BarChart data={analytics.revenueSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis
                    tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => currency.format(value)}
                  />
                  <Bar dataKey="current" fill="#10b981" radius={[8, 8, 0, 0]} />
                  <Bar
                    dataKey="previous"
                    fill="#3b82f6"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Payment method breakdown</h3>
          <div className="mt-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.paymentMethodData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={88}
                  innerRadius={48}
                >
                  {analytics.paymentMethodData.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"][index]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => currency.format(value)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Peak hours heatmap</h3>
          <div className="mt-4 overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[auto_repeat(24,minmax(24px,1fr))] gap-1 text-xs">
              <div />
              {Array.from({ length: 24 }).map((_, hour) => (
                <div key={hour} className="text-center text-muted-foreground">
                  {hour}
                </div>
              ))}
              {analytics.heatmap.map((row, dayIndex) => (
                <>
                  <div
                    key={`label-${dayIndex}`}
                    className="pr-2 text-right font-medium text-muted-foreground"
                  >
                    {
                      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                        dayIndex
                      ]
                    }
                  </div>
                  {row.map((value, hour) => (
                    <div
                      key={`${dayIndex}-${hour}`}
                      className="h-8 rounded-md"
                      style={{
                        backgroundColor: `rgba(16,185,129,${Math.min(0.12 + value * 0.18, 0.95)})`,
                      }}
                      title={`${value} transactions`}
                    />
                  ))}
                </>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-lg font-semibold">Customer segments</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-muted-foreground">New customers</p>
                <p className="mt-2 font-mono text-3xl font-semibold">
                  {analytics.segments.newCustomers}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-muted-foreground">
                  Returning customers
                </p>
                <p className="mt-2 font-mono text-3xl font-semibold">
                  {analytics.segments.returningCustomers}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {analytics.segments.loyaltyBreakdown.map((segment, index) => (
                <div key={segment.tier}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{segment.tier}</span>
                    <span>{segment.value}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${segment.value * 12}%`,
                        backgroundColor: [
                          "#94a3b8",
                          "#3b82f6",
                          "#f59e0b",
                          "#8b5cf6",
                        ][index],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-lg font-semibold">
              Table turn time distribution
            </h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.turnTimeDistribution}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Average ticket by day of week</h3>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.avgTicketByDay}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis
                tickFormatter={(value) => `${Math.round(value / 1000)}k`}
              />
              <Tooltip formatter={(value: number) => currency.format(value)} />
              <Bar dataKey="average" fill="#f59e0b" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
