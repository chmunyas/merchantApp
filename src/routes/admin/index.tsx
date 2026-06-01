import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Building2,
  CreditCard,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

import {
  ensureAdminDemoData,
  getActivityLog,
  getMerchants,
  getMerchantUsageStats,
  type AdminActivity,
  type MerchantAccount,
} from "@/lib/admin";

export const Route = createFileRoute("/admin/")({
  component: AdminOverviewPage,
});

const money = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function AdminOverviewPage() {
  const [merchants, setMerchants] = useState<MerchantAccount[]>([]);
  const [activity, setActivity] = useState<AdminActivity[]>([]);

  useEffect(() => {
    ensureAdminDemoData();
    setMerchants(getMerchants());
    setActivity(getActivityLog());
  }, []);

  const metrics = useMemo(() => {
    const usage = merchants.map((merchant) => getMerchantUsageStats(merchant));
    const verticals = new Set(
      merchants
        .filter((merchant) => merchant.status === "active")
        .map((merchant) => merchant.vertical),
    );

    return {
      totalMerchants: merchants.length,
      activeUsers: usage.reduce((sum, entry) => sum + entry.activeStaff, 0),
      revenueMtd: usage.reduce((sum, entry) => sum + entry.revenue, 0),
      pendingApprovals: merchants.filter(
        (merchant) => merchant.status === "pending",
      ).length,
      verticalsActive: verticals.size,
      totalTransactions: usage.reduce(
        (sum, entry) => sum + entry.transactions,
        0,
      ),
    };
  }, [merchants]);

  const quickLinks = [
    {
      to: "/admin/merchants",
      title: "Onboard merchants",
      description:
        "Review pending approvals, create accounts, and manage operator notes.",
    },
    {
      to: "/admin/features",
      title: "Control feature access",
      description: "Manage platform-wide flags and merchant-level overrides.",
    },
    {
      to: "/admin/activity",
      title: "Audit actions",
      description:
        "Trace who changed what across onboarding, payouts, and settings.",
    },
  ] as const;

  const feed = activity.slice(0, 10);
  const topMerchants = merchants.slice(0, 3);
  const cards = [
    {
      label: "Total Merchants",
      value: metrics.totalMerchants.toString(),
      icon: Building2,
      accent: "text-violet-300",
    },
    {
      label: "Active Users",
      value: metrics.activeUsers.toString(),
      icon: Users,
      accent: "text-emerald-300",
    },
    {
      label: "Revenue (MTD)",
      value: money.format(metrics.revenueMtd),
      icon: CreditCard,
      accent: "text-sky-300",
    },
    {
      label: "Pending Approvals",
      value: metrics.pendingApprovals.toString(),
      icon: Activity,
      accent: "text-amber-300",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-lg shadow-black/20"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{card.label}</p>
                <Icon className={`h-5 w-5 ${card.accent}`} />
              </div>
              <p className="mt-4 text-3xl font-semibold text-white">
                {card.value}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-violet-300">
                Platform health
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                Admin command centre
              </h3>
            </div>
            <div className="rounded-2xl bg-violet-500/10 px-4 py-2 text-sm text-violet-200">
              Live local demo data
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
              <p className="text-sm text-slate-400">Verticals active</p>
              <p className="mt-3 text-4xl font-semibold text-white">
                {metrics.verticalsActive}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Restaurant, retail, services, and healthcare merchants actively
                transacting.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
              <p className="text-sm text-slate-400">Total transactions</p>
              <p className="mt-3 text-4xl font-semibold text-white">
                {metrics.totalTransactions.toLocaleString()}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Combined monthly transaction volume generated from merchant demo
                accounts.
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {quickLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 transition hover:border-violet-500/40 hover:bg-slate-950"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-white">{link.title}</h4>
                  <ArrowRight className="h-4 w-4 text-violet-300" />
                </div>
                <p className="mt-3 text-sm text-slate-400">
                  {link.description}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-violet-300" />
            <div>
              <h3 className="text-lg font-semibold text-white">
                Recent activity
              </h3>
              <p className="text-sm text-slate-400">Last 10 operator actions</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {feed.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-100">
                    {entry.details}
                  </p>
                  <span className="text-xs text-slate-500">
                    {format(new Date(entry.timestamp), "dd MMM · HH:mm")}
                  </span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                  {entry.action.replaceAll("_", " ")} · {entry.adminEmail}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Merchant pulse</h3>
            <p className="text-sm text-slate-400">
              Snapshot of high-activity merchants in the current demo
              environment.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {topMerchants.map((merchant) => {
            const stats = getMerchantUsageStats(merchant);
            return (
              <div
                key={merchant.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {merchant.vertical}
                </p>
                <h4 className="mt-2 text-lg font-semibold text-white">
                  {merchant.businessName}
                </h4>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-slate-800 px-3 py-2">
                    <div className="text-slate-500">Revenue</div>
                    <div className="mt-1 font-medium text-slate-100">
                      {money.format(stats.revenue)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 px-3 py-2">
                    <div className="text-slate-500">Transactions</div>
                    <div className="mt-1 font-medium text-slate-100">
                      {stats.transactions.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
