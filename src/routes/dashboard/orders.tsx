import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  CheckCircle2,
  ChefHat,
  Clock,
  Flame,
  Package,
  Send,
  Timer,
  Utensils,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { OmniShare } from "@/components/merchant/OmniShare";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth";
import {
  type KitchenOrder,
  type OrderStatus,
  clearOldOrders,
  subscribeOrders,
  updateKitchenOrderStatus,
  useKitchenOrders,
} from "@/lib/realtime";

export const Route = createFileRoute("/dashboard/orders")({
  component: KitchenDisplayPage,
});

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; icon: typeof Clock }
> = {
  new: { label: "New", color: "bg-red-500", icon: Bell },
  accepted: { label: "Accepted", color: "bg-orange-500", icon: Clock },
  preparing: { label: "Preparing", color: "bg-amber-500", icon: Flame },
  ready: { label: "Ready", color: "bg-emerald-500", icon: Package },
  served: { label: "Served", color: "bg-slate-400", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "bg-red-300", icon: XCircle },
};

function getTimeSince(isoDate: string): string {
  const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function KitchenDisplayPage() {
  const localOrders = useKitchenOrders();
  const [apiOrders, setApiOrders] = useState<KitchenOrder[] | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [, setTick] = useState(0);
  const orders = apiOrders && apiOrders.length > 0 ? apiOrders : localOrders;
  const usingApiOrders = Boolean(apiOrders && apiOrders.length > 0);

  // Refresh time displays every 10s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, []);

  // Play sound on new order
  useEffect(() => {
    const unsub = subscribeOrders((msg) => {
      if (msg.type === "order:new") {
        toast.success(`New order from Table ${msg.order.tableNumber}`, {
          icon: <Bell className="h-4 w-4" />,
        });
        playOrderSound();
      }
    });
    return unsub;
  }, []);

  // Clear old orders periodically
  useEffect(() => {
    clearOldOrders(120);
    const id = setInterval(() => clearOldOrders(120), 300000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    authFetch("/api/orders")
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { orders?: ApiOrder[] };
        return (data.orders ?? []).map(apiOrderToKitchenOrder);
      })
      .then((next) => {
        if (!cancelled && next) setApiOrders(next);
      })
      .catch(() => {
        if (!cancelled) setApiOrders(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeOrders = useMemo(
    () =>
      orders.filter((o) => o.status !== "served" && o.status !== "cancelled"),
    [orders],
  );
  const displayOrders = filter === "active" ? activeOrders : orders;

  const stats = useMemo(
    () => ({
      newCount: orders.filter((o) => o.status === "new").length,
      preparingCount: orders.filter(
        (o) => o.status === "preparing" || o.status === "accepted",
      ).length,
      readyCount: orders.filter((o) => o.status === "ready").length,
      totalToday: orders.length,
    }),
    [orders],
  );

  async function handleStatusChange(orderId: string, newStatus: OrderStatus) {
    if (usingApiOrders) {
      const previous = apiOrders;
      setApiOrders(
        (current) =>
          current?.map((order) =>
            order.id === orderId
              ? {
                  ...order,
                  status: newStatus,
                  updatedAt: new Date().toISOString(),
                }
              : order,
          ) ?? current,
      );
      try {
        const res = await authFetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error("status update failed");
        toast.success(
          `Order ${orderId.slice(0, 8)} → ${STATUS_CONFIG[newStatus].label}`,
        );
      } catch {
        setApiOrders(previous);
        toast.error("Could not update order status");
      }
      return;
    }

    const updated = updateKitchenOrderStatus(orderId, newStatus);
    if (updated) {
      toast.success(
        `Order ${orderId.slice(0, 8)} → ${STATUS_CONFIG[newStatus].label}`,
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="New"
          value={stats.newCount}
          color="bg-red-500"
          pulse={stats.newCount > 0}
        />
        <StatCard
          label="Preparing"
          value={stats.preparingCount}
          color="bg-amber-500"
        />
        <StatCard
          label="Ready"
          value={stats.readyCount}
          color="bg-emerald-500"
        />
        <StatCard label="Today" value={stats.totalToday} color="bg-slate-500" />
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={filter === "active" ? "default" : "outline"}
            onClick={() => setFilter("active")}
            className="rounded-xl"
          >
            <Flame className="mr-1 h-3.5 w-3.5" /> Active ({activeOrders.length}
            )
          </Button>
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
            className="rounded-xl"
          >
            All ({orders.length})
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Live — updates across tabs
        </div>
      </div>

      {/* Orders grid */}
      {displayOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
          <ChefHat className="mx-auto mb-3 h-12 w-12 text-muted-foreground/40" />
          <h3 className="text-lg font-medium text-muted-foreground">
            No orders yet
          </h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground/70">
            Orders placed from customer tables will appear here in real-time.
            Try placing an order from{" "}
            <code className="rounded bg-muted px-1">/table/1</code>
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {displayOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type ApiOrder = {
  id: string;
  table_id?: string | null;
  status: OrderStatus;
  total: number | string;
  created_at?: string;
  updated_at?: string;
  items?: ApiOrderItem[];
};

type ApiOrderItem = {
  id: string;
  name: string;
  qty?: number | string;
  price?: number | string;
  notes?: string | null;
};

function apiOrderToKitchenOrder(order: ApiOrder): KitchenOrder {
  const tableId = order.table_id ?? "";
  const tableNumber = Number.parseInt(tableId, 10);
  return {
    id: order.id,
    tableId,
    tableNumber: Number.isFinite(tableNumber) ? tableNumber : 0,
    status: order.status,
    total: Number(order.total ?? 0),
    fulfilment: "dine-in",
    createdAt: order.created_at ?? new Date().toISOString(),
    updatedAt: order.updated_at ?? order.created_at ?? new Date().toISOString(),
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      quantity: Number(item.qty ?? 1),
      price: Number(item.price ?? 0),
      notes: item.notes ?? undefined,
    })),
  };
}

function StatCard({
  label,
  value,
  color,
  pulse,
}: {
  label: string;
  value: number;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div
          className={`h-3 w-3 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`}
        />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function OrderCard({
  order,
  onStatusChange,
}: {
  order: KitchenOrder;
  onStatusChange: (id: string, status: OrderStatus) => void;
}) {
  const config = STATUS_CONFIG[order.status];
  const StatusIcon = config.icon;
  const isNew = order.status === "new";
  const isFinished = order.status === "served" || order.status === "cancelled";
  const [payLink, setPayLink] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);

  async function requestPayment() {
    setMinting(true);
    try {
      const res = await authFetch(`/api/orders/${order.id}/pay-link`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        payUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.payUrl) {
        toast.error(data.error || "Couldn't create the pay link");
        return;
      }
      setPayLink(data.payUrl);
    } catch {
      toast.error("Couldn't create the pay link");
    } finally {
      setMinting(false);
    }
  }

  return (
    <div
      className={`relative rounded-2xl border bg-card p-4 transition-all ${
        isNew
          ? "border-red-300 ring-2 ring-red-200 shadow-lg animate-pulse-subtle"
          : "border-border"
      } ${isFinished ? "opacity-60" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Utensils className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">Table {order.tableNumber}</span>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {order.id}
          </p>
        </div>
        <div
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-white ${config.color}`}
        >
          <StatusIcon className="h-3 w-3" />
          {config.label}
        </div>
      </div>

      {/* Time */}
      <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
        <Timer className="h-3.5 w-3.5" />
        {getTimeSince(order.createdAt)} ago
        {order.fulfilment !== "dine-in" && (
          <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 uppercase">
            {order.fulfilment}
          </span>
        )}
      </div>

      {/* Items */}
      <div className="mt-3 space-y-1.5 border-t border-border pt-3">
        {order.items.map((item) => (
          <div
            key={item.id}
            className="flex items-start justify-between text-sm"
          >
            <div className="flex-1">
              <span className="font-medium">
                {item.quantity}× {item.name}
              </span>
              {item.notes && (
                <p className="text-[11px] text-amber-600 italic">
                  → {item.notes}
                </p>
              )}
              {item.options && item.options.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {item.options.join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Customer note */}
      {order.customerNote && (
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
          📝 {order.customerNote}
        </div>
      )}

      {/* Total */}
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {order.items.length} item(s)
        </span>
        <span className="font-bold">KES {order.total.toLocaleString()}</span>
      </div>

      {/* Take payment against this order (split-aware /pay?o= link) */}
      {!isFinished && order.total > 0 ? (
        <button
          onClick={requestPayment}
          disabled={minting}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {minting ? "Creating link…" : "Request payment"}
        </button>
      ) : null}
      {payLink ? (
        <OmniShare
          open={!!payLink}
          onClose={() => setPayLink(null)}
          title={`Send bill · Table ${order.tableNumber}`}
          message={`Your bill for KES ${order.total.toLocaleString()} is ready. Split it or pay in full 👇`}
          link={payLink}
        />
      ) : null}

      {/* Action buttons */}
      {!isFinished && (
        <div className="mt-3 flex gap-2">
          {order.status === "new" && (
            <>
              <Button
                size="sm"
                className="flex-1 rounded-xl bg-orange-500 hover:bg-orange-600"
                onClick={() => onStatusChange(order.id, "accepted")}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-red-600 hover:bg-red-50"
                onClick={() => onStatusChange(order.id, "cancelled")}
              >
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {order.status === "accepted" && (
            <Button
              size="sm"
              className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600"
              onClick={() => onStatusChange(order.id, "preparing")}
            >
              <Flame className="mr-1 h-3.5 w-3.5" /> Start Preparing
            </Button>
          )}
          {order.status === "preparing" && (
            <Button
              size="sm"
              className="flex-1 rounded-xl bg-emerald-500 hover:bg-emerald-600"
              onClick={() => onStatusChange(order.id, "ready")}
            >
              <Package className="mr-1 h-3.5 w-3.5" /> Mark Ready
            </Button>
          )}
          {order.status === "ready" && (
            <Button
              size="sm"
              className="flex-1 rounded-xl"
              onClick={() => onStatusChange(order.id, "served")}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Served
            </Button>
          )}
        </div>
      )}

      {/* Pulse animation for new orders */}
      <style>{`
        @keyframes pulse-subtle {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
          50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
        }
        .animate-pulse-subtle { animation: pulse-subtle 2s infinite; }
      `}</style>
    </div>
  );
}

function playOrderSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    /* audio unavailable */
  }
}
