import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { authFetch, hasAuthoritativeVenueSession } from "@/lib/auth";
import { useAuthQuery } from "@/lib/use-auth-query";

import { OmniShare } from "../OmniShare";
import { TableServiceView } from "./TableServiceView";

type ServerOrderItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
  notes: string | null;
};

type ServerOrder = {
  id: string;
  table_id: string | null;
  status: string;
  total: number | string;
  paid: number | string;
  currency: string;
  paid_at: string | null;
  created_at: string;
  items: ServerOrderItem[];
};

const NEXT_STATUS: Record<string, string> = {
  new: "accepted",
  accepted: "preparing",
  preparing: "ready",
  ready: "served",
};

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
};

function money(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency,
      minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toLocaleString()}`;
  }
}

export function SyncedTableServiceView() {
  if (hasAuthoritativeVenueSession()) return <ServerTableOrders />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-4 mt-3 flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-xs font-bold">Demo table planner</p>
          <p className="mt-0.5 text-[10px] leading-relaxed">
            These tables and simulated payments stay on this device and are not
            accounting records. Sign in to run synchronized table operations.
          </p>
        </div>
      </div>
      <TableServiceView />
    </div>
  );
}

function ServerTableOrders() {
  const query = useAuthQuery<{ orders: ServerOrder[] }, ServerOrder[]>(
    ["operator-orders"],
    "/api/orders",
    {
      select: (data) => data.orders ?? [],
      refetchInterval: 10_000,
    },
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [share, setShare] = useState<{
    url: string;
    order: ServerOrder;
    remaining: number;
  } | null>(null);
  const visible = useMemo(
    () =>
      (query.data ?? []).filter((order) => {
        const remaining = Math.max(0, Number(order.total) - Number(order.paid));
        return (
          remaining > 0 ||
          !["served", "cancelled"].includes(String(order.status))
        );
      }),
    [query.data],
  );
  const outstanding = visible.reduce(
    (total, order) =>
      total + Math.max(0, Number(order.total) - Number(order.paid)),
    0,
  );

  async function advance(order: ServerOrder) {
    const next = NEXT_STATUS[order.status];
    if (!next || busyId) return;
    setBusyId(order.id);
    try {
      const response = await authFetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error("status update failed");
      toast.success(`Order marked ${STATUS_LABEL[next].toLowerCase()}.`);
      await query.refetch();
    } catch {
      toast.error("The order status was not saved. Refresh and try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function requestPayment(order: ServerOrder) {
    if (busyId) return;
    setBusyId(order.id);
    try {
      const response = await authFetch(`/api/orders/${order.id}/pay-link`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        payUrl?: string;
        remaining?: number;
        error?: string;
      };
      if (!response.ok || !data.payUrl) {
        throw new Error(data.error ?? "payment link unavailable");
      }
      setShare({
        url: data.payUrl,
        order,
        remaining: Number(data.remaining) || 0,
      });
      await query.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The payment link could not be created.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Loading live orders…
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-24 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Floor
          </p>
          <h1 className="text-lg font-bold">Live table orders</h1>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Same orders and balances as the kitchen and back office.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/dashboard/orders"
            className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            KDS
          </Link>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh live table orders"
            className="flex size-11 items-center justify-center rounded-full border border-border bg-card disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${query.isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-foreground p-3 text-background">
          <p className="text-[9px] uppercase tracking-wide opacity-60">Open</p>
          <p className="mt-1 font-mono text-xl font-bold">{visible.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Outstanding
          </p>
          <p className="mt-1 font-mono text-xl font-bold">
            {money(outstanding, "KES")}
          </p>
        </div>
      </div>

      {query.isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          Live orders are unavailable. No local table data is being substituted.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center">
          <CheckCircle2 className="mx-auto size-7 text-emerald-600" />
          <p className="mt-2 text-sm font-semibold">No active table orders</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Take an order from the Order tab to send it to the kitchen.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((order) => {
            const total = Number(order.total) || 0;
            const paid = Number(order.paid) || 0;
            const remaining = Math.max(0, total - paid);
            const next = NEXT_STATUS[order.status];
            return (
              <article
                key={order.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">
                      {order.table_id
                        ? `Table ${order.table_id}`
                        : "Counter order"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(order.created_at).toLocaleString()} ·{" "}
                      {order.items.length} line
                      {order.items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-1 text-[9px] font-semibold">
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </div>

                <div className="mt-3 space-y-1 border-y border-border py-2">
                  {order.items.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between gap-3 text-[11px]"
                    >
                      <span className="truncate">
                        {item.qty} × {item.name}
                      </span>
                      <span className="shrink-0 font-mono">
                        {money(
                          Number(item.price) * Number(item.qty),
                          order.currency,
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[9px] text-muted-foreground">Total</p>
                    <p className="font-mono text-xs font-bold">
                      {money(total, order.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground">
                      Collected
                    </p>
                    <p className="font-mono text-xs font-bold text-emerald-700">
                      {money(paid, order.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground">
                      Remaining
                    </p>
                    <p className="font-mono text-xs font-bold text-amber-700">
                      {money(remaining, order.currency)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void requestPayment(order)}
                    disabled={remaining <= 0 || busyId === order.id}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {busyId === order.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    Request payment
                  </button>
                  <button
                    type="button"
                    onClick={() => void advance(order)}
                    disabled={!next || busyId === order.id}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold disabled:opacity-40"
                  >
                    <ChefHat className="size-4" />
                    {next ? `Mark ${STATUS_LABEL[next]}` : "Complete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {share ? (
        <OmniShare
          kind="payment_link"
          open
          onClose={() => setShare(null)}
          title={`Request ${money(Math.round(share.remaining * 100), share.order.currency)}`}
          message={`Your secure payment link for ${share.order.table_id ? `table ${share.order.table_id}` : "your order"}.`}
          link={share.url}
        />
      ) : null}
    </div>
  );
}
