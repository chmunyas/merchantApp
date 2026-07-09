import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Building2,
  Coins,
  Inbox,
  Receipt,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import {
  authFetch,
  staffMyVenues,
  staffSwitchVenue,
  useAuth,
  type StaffVenue,
} from "@/lib/auth";

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
  const [venues, setVenues] = useState<StaffVenue[]>([]);

  useEffect(() => {
    void staffMyVenues().then(setVenues);
  }, []);

  async function switchTo(id: string) {
    const ok = await staffSwitchVenue(id);
    if (ok) window.location.reload();
  }

  useEffect(() => {
    authFetch("/api/tips?scope=team&period=today")
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

      {venues.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {venues.length > 1 ? "Your stores" : "Working at"}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {venues.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => (v.current ? undefined : switchTo(v.id))}
                disabled={v.current}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  v.current
                    ? "bg-foreground text-background"
                    : "border border-border hover:border-foreground/40"
                }`}
              >
                {v.name}
                {v.current ? " · now" : ""}
              </button>
            ))}
          </div>
        </section>
      ) : null}

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
