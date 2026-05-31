import { createFileRoute } from "@tanstack/react-router";
import {
  differenceInMinutes,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Trophy, Zap, Flame } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ensureMerchantDemoData,
  flattenTransactions,
  loadMerchantSnapshot,
  STAFF_NAMES,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/dashboard/staff")({
  component: DashboardStaffPage,
});

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

type Period = "today" | "week" | "month";

function generateDemoData() {
  return ensureMerchantDemoData();
}

function DashboardStaffPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [period, setPeriod] = useState<Period>("week");

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
  }, []);

  const data = useMemo(() => {
    if (!snapshot) return null;

    const now = new Date();
    const transactions = flattenTransactions(snapshot.tables).filter(
      (transaction) => transaction.status === "succeeded",
    );
    const filteredTransactions = transactions.filter((transaction) => {
      const createdAt = new Date(transaction.createdAt);
      if (period === "today") return isSameDay(createdAt, now);
      if (period === "week")
        return createdAt >= startOfWeek(now, { weekStartsOn: 1 });
      return createdAt >= startOfMonth(now);
    });

    const servedOrders = snapshot.orders.filter((order) => order.servedAt);
    const leaderboard = STAFF_NAMES.map((name) => {
      const staffTransactions = filteredTransactions.filter(
        (transaction) => transaction.server === name,
      );
      const staffReviews = snapshot.reviews.filter(
        (review) => review.server === name,
      );
      const staffOrders = servedOrders.filter((order) => order.server === name);
      const totalTips = staffTransactions.reduce(
        (sum, transaction) => sum + transaction.tip,
        0,
      );
      const avgTipPercent = staffTransactions.length
        ? staffTransactions.reduce(
            (sum, transaction) =>
              sum + transaction.tip / Math.max(transaction.amount, 1),
            0,
          ) / staffTransactions.length
        : 0;
      const avgRating = staffReviews.length
        ? staffReviews.reduce((sum, review) => sum + review.rating, 0) /
          staffReviews.length
        : 0;
      const avgTurnTime = staffOrders.length
        ? staffOrders.reduce(
            (sum, order) =>
              sum +
              differenceInMinutes(
                new Date(order.servedAt!),
                new Date(order.orderedAt),
              ),
            0,
          ) / staffOrders.length
        : 0;

      return {
        name,
        tablesServed: staffTransactions.length,
        totalTips,
        avgTipPercent: avgTipPercent * 100,
        avgRating,
        avgTurnTime,
      };
    }).sort((a, b) => b.totalTips - a.totalTips);

    const tipDistribution = leaderboard.map((entry) => ({
      name: entry.name,
      totalTips: entry.totalTips,
    }));

    const tipTrend = Array.from({ length: period === "today" ? 8 : 7 }).map(
      (_, index) => {
        const bucketDate = new Date();
        bucketDate.setDate(
          bucketDate.getDate() - (period === "today" ? 0 : 6 - index),
        );
        const label =
          period === "today" ? `${11 + index}:00` : format(bucketDate, "EEE");
        const totals = STAFF_NAMES.reduce<Record<string, number>>(
          (acc, name, staffIndex) => {
            acc[name] = filteredTransactions
              .filter((transaction) => {
                const createdAt = new Date(transaction.createdAt);
                if (period === "today")
                  return createdAt.getHours() === 11 + index;
                return (
                  format(createdAt, "yyyy-MM-dd") ===
                  format(bucketDate, "yyyy-MM-dd")
                );
              })
              .filter((transaction) => transaction.server === name)
              .reduce(
                (sum, transaction) => sum + transaction.tip + staffIndex * 0,
                0,
              );
            return acc;
          },
          {},
        );
        return { label, ...totals };
      },
    );

    return {
      leaderboard,
      tipDistribution,
      tipTrend,
      badges: {
        topTipper: leaderboard[0]?.name,
        fastestService: [...leaderboard].sort(
          (a, b) => a.avgTurnTime - b.avgTurnTime,
        )[0]?.name,
        mostTables: [...leaderboard].sort(
          (a, b) => b.tablesServed - a.tablesServed,
        )[0]?.name,
      },
    };
  }, [snapshot, period]);

  if (!snapshot || !data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading staff insights…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-2xl font-semibold">Staff performance</h3>
          <p className="text-sm text-muted-foreground">
            Tips, speed, satisfaction, and service load by server.
          </p>
        </div>
        <select
          value={period}
          onChange={(event) => setPeriod(event.target.value as Period)}
          className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 text-amber-500">
            <Trophy className="h-5 w-5" />{" "}
            <span className="font-medium">Top Tipper 🏆</span>
          </div>
          <p className="mt-4 text-2xl font-semibold">{data.badges.topTipper}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 text-blue-500">
            <Zap className="h-5 w-5" />{" "}
            <span className="font-medium">Fastest Service ⚡</span>
          </div>
          <p className="mt-4 text-2xl font-semibold">
            {data.badges.fastestService}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 text-rose-500">
            <Flame className="h-5 w-5" />{" "}
            <span className="font-medium">Most Tables 🔥</span>
          </div>
          <p className="mt-4 text-2xl font-semibold">
            {data.badges.mostTables}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-muted-foreground">
              <tr>
                {[
                  "Rank",
                  "Server Name",
                  "Tables Served",
                  "Total Tips",
                  "Avg Tip %",
                  "Avg Rating",
                  "Avg Turn Time",
                ].map((column) => (
                  <th key={column} className="px-4 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.leaderboard.map((entry, index) => (
                <tr
                  key={entry.name}
                  className={`border-t border-border ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
                >
                  <td className="px-4 py-3 font-medium">#{index + 1}</td>
                  <td className="px-4 py-3 font-medium">{entry.name}</td>
                  <td className="px-4 py-3">{entry.tablesServed}</td>
                  <td className="px-4 py-3 font-mono">
                    {currency.format(entry.totalTips)}
                  </td>
                  <td className="px-4 py-3">
                    {entry.avgTipPercent.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">{entry.avgRating.toFixed(1)}</td>
                  <td className="px-4 py-3">
                    {Math.round(entry.avgTurnTime)} min
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Tips distribution</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.tipDistribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <Tooltip
                  formatter={(value: number) => currency.format(value)}
                />
                <Bar dataKey="totalTips" fill="#10b981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Tip trend</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.tipTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <Tooltip
                  formatter={(value: number) => currency.format(value)}
                />
                <Legend />
                {STAFF_NAMES.map((name, index) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"][index]}
                    strokeWidth={2.5}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
