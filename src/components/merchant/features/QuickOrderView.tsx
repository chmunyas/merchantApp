import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChefHat,
  Loader2,
  Minus,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";

import { authFetch } from "@/lib/auth";
import { toOrderItems, orderPadTotal, type OrderPadLine } from "@/lib/order-pad";

// A fast, clear, accurate staff order pad. Tap menu items to build an order, then
// send it straight to the Kitchen Display — server-authoritative (POST /api/orders)
// so it reaches the kitchen on ANY device, not just this one. Prices come from the
// menu in whole KES; orders are stored in minor units, so we ×100 on send.

type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number; // whole KES
};

type Line = OrderPadLine;

function ding() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* audio unavailable */
  }
}

export function QuickOrderView() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [table, setTable] = useState("");
  const [sending, setSending] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    let alive = true;
    authFetch("/api/menu")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Array<Record<string, unknown>> }) => {
        if (!alive) return;
        setItems(
          (d.items ?? []).map((i) => ({
            id: String(i.id),
            name: String(i.name ?? "").trim(),
            category: String(i.category ?? "Menu").trim() || "Menu",
            price: Number(i.price) || 0,
          })),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(items.map((i) => i.category)))],
    [items],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (cat === "All" || i.category === cat) &&
        (!needle || i.name.toLowerCase().includes(needle)),
    );
  }, [items, cat, q]);

  const lines = useMemo(
    () => Object.values(cart).filter((l) => l.qty > 0),
    [cart],
  );
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = orderPadTotal(lines);

  function add(item: MenuItem) {
    setCart((prev) => {
      const l = prev[item.name] ?? {
        name: item.name,
        price: item.price,
        qty: 0,
        notes: "",
      };
      return { ...prev, [item.name]: { ...l, qty: l.qty + 1 } };
    });
  }
  function setQty(name: string, qty: number) {
    setCart((prev) => ({ ...prev, [name]: { ...prev[name], qty: Math.max(0, qty) } }));
  }
  function setNotes(name: string, notes: string) {
    setCart((prev) => ({ ...prev, [name]: { ...prev[name], notes } }));
  }
  function clearAll() {
    setCart({});
    setTable("");
  }

  async function send() {
    if (lines.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await authFetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tableId: table.trim() || undefined,
          items: toOrderItems(lines),
        }),
      });
      if (!res.ok) throw new Error("send failed");
      toast.success(
        `Sent to kitchen ✓${table.trim() ? ` · Table ${table.trim()}` : ""}`,
      );
      ding();
      clearAll();
      setReviewing(false);
    } catch {
      toast.error("Couldn't send the order — check your connection and retry");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading menu…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <ChefHat className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <h3 className="font-medium">No menu items yet</h3>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Add items to your menu first, then take orders here and send them
          straight to the kitchen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Table + search */}
      <div className="space-y-2 px-4 pt-3">
        <div className="flex gap-2">
          <input
            value={table}
            onChange={(e) => setTable(e.target.value)}
            inputMode="numeric"
            placeholder="Table #"
            className="w-24 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold"
            aria-label="Table number"
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search menu…"
              className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm"
              aria-label="Search menu"
            />
          </div>
        </div>
        {/* Category pills */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                cat === c
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Menu grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-40 pt-2">
        <div className="grid grid-cols-2 gap-2">
          {visible.map((item) => {
            const qty = cart[item.name]?.qty ?? 0;
            return (
              <button
                key={item.id}
                onClick={() => add(item)}
                className="relative flex flex-col items-start rounded-2xl border border-border bg-card p-3 text-left transition active:scale-[0.98]"
              >
                {qty > 0 && (
                  <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-xs font-bold text-white">
                    {qty}
                  </span>
                )}
                <span className="pr-7 text-sm font-semibold leading-tight">
                  {item.name}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  KES {item.price.toLocaleString()}
                </span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">
              No items match “{q}”.
            </p>
          )}
        </div>
      </div>

      {/* Sticky order bar */}
      {count > 0 && (
        <div className="absolute inset-x-0 bottom-16 z-10 border-t border-border bg-card/95 p-3 backdrop-blur">
          {reviewing && (
            <div className="mb-3 max-h-52 space-y-2 overflow-y-auto">
              {lines.map((l) => (
                <div
                  key={l.name}
                  className="rounded-xl border border-border bg-background p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-medium">{l.name}</span>
                    <button
                      onClick={() => setQty(l.name, l.qty - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border"
                      aria-label={`Decrease ${l.name}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold">
                      {l.qty}
                    </span>
                    <button
                      onClick={() => setQty(l.name, l.qty + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border"
                      aria-label={`Increase ${l.name}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setQty(l.name, 0)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500"
                      aria-label={`Remove ${l.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    value={l.notes}
                    onChange={(e) => setNotes(l.name, e.target.value)}
                    placeholder="Add a note (e.g. no chilli, well done)…"
                    className="mt-2 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReviewing((v) => !v)}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-3 text-left"
            >
              <span className="text-xs text-muted-foreground">
                {count} item{count === 1 ? "" : "s"}
                {table.trim() ? ` · Table ${table.trim()}` : ""}
              </span>
              <span className="block text-lg font-bold leading-tight">
                KES {total.toLocaleString()}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {reviewing ? "Hide items" : "Review items"}
              </span>
            </button>
            <button
              onClick={send}
              disabled={sending}
              className="flex min-w-[9rem] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {sending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              {sending ? "Sending…" : "Send to Kitchen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
