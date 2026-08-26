import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Coins,
  Inbox,
  Receipt,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import {
  authFetch,
  useAuth,
} from "@/lib/auth";
import { MyTablesCard } from "@/components/staff/MyTablesCard";
import { MyEarningsCard } from "@/components/staff/MyEarningsCard";
import { TableFloorActionsCard } from "@/components/staff/TableFloorActionsCard";
import { WalkoutReportCard } from "@/components/staff/WalkoutReportCard";

export const Route = createFileRoute("/staff-console")({
  component: StaffConsole,
});

type TipRow = {
  staff_id: string | null;
  name: string | null;
  tips: number;
  payments: number;
};

function StaffConsole() {
  const { user } = useAuth();
  const [tips, setTips] = useState<TipRow[] | null>(null);
  const [openOrders, setOpenOrders] = useState<number | null>(null);

  useEffect(() => {
    authFetch("/api/tips?scope=me&period=today")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTips((d?.tips as TipRow[]) ?? null))
      .catch(() => {});
    authFetch("/api/orders?status=new")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setOpenOrders(Array.isArray(d?.orders) ? d.orders.length : null),
      )
      .catch(() => {});
  }, []);

  const tiles = [
    {
      to: "/dashboard/invoices",
      label: "Send a bill",
      icon: Receipt,
      desc: "Create an invoice + pay link",
    },
    {
      to: "/dashboard/orders",
      label: "Orders",
      icon: UtensilsCrossed,
      desc: openOrders != null ? `${openOrders} open` : "Kitchen tickets",
    },
    {
      to: "/dashboard/inbox",
      label: "Inbox",
      icon: Inbox,
      desc: "Reply to guests",
    },
    {
      to: "/dashboard/contacts",
      label: "Customers",
      icon: Users,
      desc: "Look up a guest",
    },
  ] as const;

  const totalTips = (tips ?? []).reduce((s, t) => s + Number(t.tips || 0), 0);

  if (!user || user.role !== "staff") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Staff sign-in required</h1>
          <Link to="/staff-login" className="mt-3 inline-block text-primary underline">
            Go to staff sign-in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Staff console
        </p>
        <h1 className="mt-1 text-2xl font-bold">Hi {user?.name ?? "there"}</h1>
        <p className="text-sm text-muted-foreground">
          {user?.role ?? "staff"} · take payment, manage orders, help guests
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition hover:border-foreground/30"
          >
            <div className="flex size-12 items-center justify-center rounded-xl bg-foreground/5">
              <t.icon className="size-6" />
            </div>
            <div>
              <p className="font-semibold">{t.label}</p>
              <p className="text-sm text-muted-foreground">{t.desc}</p>
            </div>
          </Link>
        ))}
      </section>

      <MyTablesCard />

      {/* B3.1 + B3.5 — search a table, resend its bill/receipt, refund. */}
      <TableFloorActionsCard />

      {/* C9.2 + C9.3 — report a walkout without closing the check. */}
      <WalkoutReportCard />

      <MyEarningsCard />

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <Coins className="size-5 text-amber-500" />
          <h2 className="text-lg font-semibold">Tips today</h2>
        </div>
        {tips == null ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Tip tracking appears here once tips are recorded.
          </p>
        ) : tips.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No tips yet today.</p>
        ) : (
          <>
            <p className="mt-2 text-3xl font-bold">
              KES {(totalTips / 100).toLocaleString()}
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Server</th>
                  <th>Payments</th>
                  <th className="text-right">Tips</th>
                </tr>
              </thead>
              <tbody>
                {tips.map((t, i) => (
                  <tr
                    key={t.staff_id ?? i}
                    className="border-t border-border"
                  >
                    <td className="py-1 font-medium">
                      {t.name ?? "Unassigned"}
                    </td>
                    <td>{t.payments}</td>
                    <td className="text-right">
                      KES {(Number(t.tips) / 100).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
