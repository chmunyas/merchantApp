import { createFileRoute } from "@tanstack/react-router";
import { format, isSameDay, subDays } from "date-fns";
import {
  Activity,
  ArrowUpRight,
  CreditCard,
  Receipt,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Cell,
  CartesianGrid,
  Legend,
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
  getSeatedCombinationsByTable,
  loadMerchantSnapshot,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";
import { OnboardingChecklist } from "@/components/merchant/OnboardingChecklist";
import { LaunchAppCard } from "@/components/merchant/LaunchAppCard";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardOverviewPage,
});

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const pieColors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6"];

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : format(date, "dd MMM, HH:mm");
}

function generateDemoData() {
  return ensureMerchantDemoData();
}

function DashboardOverviewPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
  }, []);

  const metrics = useMemo(() => {
    if (!snapshot) return null;

    const transactions = flattenTransactions(snapshot.tables);
    const today = new Date();
    const todaysTransactions = transactions.filter(
      (transaction) =>
        transaction.status === "succeeded" &&
        isSameDay(new Date(transaction.createdAt), today),
    );
    const todayRevenue = todaysTransactions.reduce(
      (sum, transaction) => sum + transaction.amount + transaction.tip,
      0,
    );
    const averageTicket = todaysTransactions.length
      ? todayRevenue / todaysTransactions.length
      : 0;
    const activeTables = snapshot.tables.filter(
      (table) => table.status !== "closed",
    ).length;
    const qrTransactions = transactions.filter(
      (transaction) => transaction.metadata?.flow_type === "qr_pay",
    ).length;
    const manualTransactions = transactions.filter(
      (transaction) => transaction.metadata?.channel === "manual-entry",
    ).length;

    const revenueTrend = Array.from({ length: 7 }).map((_, index) => {
      const date = subDays(today, 6 - index);
      const amount = transactions
        .filter((transaction) =>
          isSameDay(new Date(transaction.createdAt), date),
        )
        .reduce((sum, transaction) => {
          if (transaction.status === "failed") return sum;
          const signedAmount =
            transaction.status === "refunded"
              ? -transaction.amount
              : transaction.amount + transaction.tip;
          return sum + signedAmount;
        }, 0);
      return { label: format(date, "EEE"), revenue: amount };
    });

    const methodBreakdown = ["M-Pesa", "Card", "Split", "Cash"].map(
      (method) => ({
        name: method,
        value: transactions
          .filter(
            (transaction) =>
              transaction.method === method && transaction.status !== "failed",
          )
          .reduce((sum, transaction) => sum + transaction.amount, 0),
      }),
    );

    return {
      todayRevenue,
      transactionCount: todaysTransactions.length,
      averageTicket,
      activeTables,
      adoptionRate:
        qrTransactions + manualTransactions
          ? (qrTransactions / (qrTransactions + manualTransactions)) * 100
          : 0,
      revenueTrend,
      methodBreakdown,
      transactions: transactions.slice(0, 10),
    };
  }, [snapshot]);

  const combinedByTable = useMemo(() => {
    const map = new Map<number, string>();
    if (!snapshot) return map;
    getSeatedCombinationsByTable(
      snapshot.tableCombinations,
      snapshot.reservations,
    ).forEach((combination, tableNumber) => {
      map.set(tableNumber, combination.name);
    });
    return map;
  }, [snapshot]);

  if (!snapshot || !metrics) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading dashboard…
      </div>
    );
  }

  const kpis = [
    {
      label: "Revenue Today",
      value: currency.format(metrics.todayRevenue),
      icon: Wallet,
      accent: "text-emerald-500",
    },
    {
      label: "Transactions",
      value: metrics.transactionCount.toString(),
      icon: CreditCard,
      accent: "text-blue-500",
    },
    {
      label: "Avg Ticket",
      value: currency.format(metrics.averageTicket),
      icon: Receipt,
      accent: "text-amber-500",
    },
    {
      label: "Active Tables",
      value: metrics.activeTables.toString(),
      icon: Activity,
      accent: "text-purple-500",
    },
  ];

  return (
    <div className="space-y-6">
      <OnboardingChecklist snapshot={snapshot} />
      <LaunchAppCard />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="rounded-2xl border border-border bg-card p-6"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{item.label}</p>
                <Icon className={`h-5 w-5 ${item.accent}`} />
              </div>
              <p className="mt-4 font-mono text-3xl font-semibold">
                {item.value}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600">
                <ArrowUpRight className="h-3.5 w-3.5" /> Stronger than last
                service window
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Revenue · last 7 days</h3>
              <p className="text-sm text-muted-foreground">
                Net sales including tips and refunds
              </p>
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <Tooltip
                  formatter={(value: number) => currency.format(value)}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">QR pay adoption</p>
            <p className="mt-3 font-mono text-4xl font-semibold">
              {metrics.adoptionRate.toFixed(0)}%
            </p>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${metrics.adoptionRate}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Share of QR payments vs manual entries today.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-lg font-semibold">Payment method mix</h3>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.methodBreakdown}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={75}
                  >
                    {metrics.methodBreakdown.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={pieColors[index % pieColors.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => currency.format(value)}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.2fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Live table status</h3>
              <p className="text-sm text-muted-foreground">
                Dining room snapshot from local storage
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {snapshot.tables.map((table) => (
              <div
                key={table.id}
                className="rounded-2xl border border-border bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Table {table.tableNumber}
                    </p>
                    <p className="mt-1 text-sm font-medium">{table.server}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      table.status === "open"
                        ? "bg-emerald-100 text-emerald-700"
                        : table.status === "requesting-bill"
                          ? "bg-amber-100 text-amber-700"
                          : table.status === "partially-paid"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {table.status.replace("-", " ")}
                  </span>
                </div>
                {combinedByTable.has(table.tableNumber) ? (
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    Combined · {combinedByTable.get(table.tableNumber)}
                  </div>
                ) : null}
                <div className="mt-4 text-sm text-muted-foreground">
                  {table.items.length} items in play
                </div>
                <div className="mt-3 font-mono text-lg font-semibold">
                  {currency.format(table.paidAmount || 0)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Recent transactions</h3>
              <p className="text-sm text-muted-foreground">
                Most recent 10 payment events
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {metrics.transactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between rounded-2xl border border-border px-4 py-3"
              >
                <div>
                  <div className="font-medium">{transaction.customerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {transaction.reference} · Table {transaction.tableNumber} ·{" "}
                    {formatDateTime(transaction.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold">
                    {currency.format(transaction.amount + transaction.tip)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {transaction.method}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
