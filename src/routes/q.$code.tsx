import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Loader2, Minus, Phone, Plus, ShoppingBag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loyaltyPointsFor } from "@/lib/loyalty";

export const Route = createFileRoute("/q/$code")({
  component: UnifiedQrPage,
});

type Branding = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  reseller: { name: string; poweredBy: string | null; logoUrl: string | null } | null;
};

type MenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  dietary: string[];
  available: boolean;
};

type QrPayload = {
  venue: { id: string; name: string };
  branding: Branding;
  table: { id: string; label: string | null; section: string | null } | null;
  items: MenuItem[];
};

type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
};

type LoyaltyStatus = {
  enrolled: boolean;
  name?: string;
  points?: number;
  tier?: string;
  nextTier?: string | null;
  pointsToNext?: number;
};

function formatKes(amount: number): string {
  return `KES ${(amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function groupedItems(items: MenuItem[]): Array<[string, MenuItem[]]> {
  const groups = new Map<string, MenuItem[]>();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category)!.push(item);
  }
  return Array.from(groups.entries());
}

function UnifiedQrPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState<QrPayload | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyStatus | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promoResult, setPromoResult] = useState<{
    valid: boolean;
    discount: number;
    finalTotal: number;
    reason?: string;
  } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/qr/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("This QR code could not be loaded.");
        return (await res.json()) as QrPayload;
      })
      .then((data) => {
        if (!cancelled) {
          setPayload(data);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const grouped = useMemo(() => groupedItems(payload?.items ?? []), [payload]);
  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    [cart],
  );
  const discount = promoResult?.valid ? promoResult.discount : 0;
  const payable = Math.max(0, total - discount);
  const estPoints = useMemo(() => loyaltyPointsFor(payable), [payable]);
  const venueId = payload?.venue.id;

  // Clear a stale promo when the cart changes; the guest re-applies against the new
  // subtotal (and the order handler re-validates server-side regardless).
  useEffect(() => {
    setPromoResult(null);
  }, [total]);

  // Look up a returning guest's loyalty inline (debounced) so points + tier show
  // while they order — the "earn on this order" nudge. Read-only; never blocks.
  useEffect(() => {
    const digits = phone.replace(/[^0-9]/g, "");
    if (!venueId || digits.length < 9) {
      setLoyalty(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/loyalty/status?venue=${encodeURIComponent(venueId)}&phone=${encodeURIComponent(phone)}`,
          );
          if (!res.ok) return;
          const d = (await res.json()) as LoyaltyStatus;
          if (active) setLoyalty(d);
        } catch {
          /* the loyalty banner is a bonus — never block ordering */
        }
      })();
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [phone, venueId]);
  const quantityById = useMemo(
    () =>
      cart.reduce<Record<string, number>>((acc, item) => {
        acc[item.id] = item.qty;
        return acc;
      }, {}),
    [cart],
  );

  function updateQty(item: MenuItem, delta: number) {
    if (!item.available) return;
    setCart((current) => {
      const existing = current.find((entry) => entry.id === item.id);
      if (!existing && delta > 0) {
        return [
          ...current,
          { id: item.id, name: item.name, price: item.price, qty: 1 },
        ];
      }
      return current
        .map((entry) =>
          entry.id === item.id
            ? { ...entry, qty: Math.max(0, entry.qty + delta) }
            : entry,
        )
        .filter((entry) => entry.qty > 0);
    });
  }

  async function applyCode() {
    const codeStr = promoInput.trim();
    if (!codeStr || !venueId || total <= 0) return;
    setPromoBusy(true);
    try {
      const res = await fetch(
        `/api/promo/validate?venue=${encodeURIComponent(venueId)}&code=${encodeURIComponent(codeStr)}&subtotal=${total}`,
      );
      const d = (await res.json()) as {
        valid: boolean;
        discount: number;
        finalTotal: number;
        reason?: string;
      };
      setPromoResult(d);
    } catch {
      setPromoResult({
        valid: false,
        discount: 0,
        finalTotal: total,
        reason: "Couldn't check that code",
      });
    } finally {
      setPromoBusy(false);
    }
  }

  async function pay() {
    if (!payload || total <= 0) return;
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`/api/qr/${encodeURIComponent(code)}/order`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.map(({ name, price, qty }) => ({ name, price, qty })),
          phone: phone.trim() || undefined,
          promoCode: promoResult?.valid ? promoInput.trim() : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        payUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.payUrl) {
        throw new Error(data.error ?? "Could not start payment.");
      }
      // Seamless in-app transition to pay (no full-page reload) — scan → order →
      // pay is one continuous flow. Fall back to a hard redirect if parsing fails.
      let token: string | null = null;
      try {
        token = new URL(data.payUrl, window.location.origin).searchParams.get(
          "o",
        );
      } catch {
        token = null;
      }
      if (token) {
        void navigate({ to: "/pay", search: { o: token } });
      } else {
        window.location.href = data.payUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start payment.");
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </main>
    );
  }

  if (error && !payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">QR unavailable</p>
          <p className="mt-2 text-sm text-slate-300">{error}</p>
        </div>
      </main>
    );
  }

  if (!payload) return null;
  const accent = payload.branding.primaryColor ?? "#059669";

  return (
    <main className="min-h-screen bg-slate-100 pb-36">
      <section
        className="rounded-b-[2rem] px-5 pb-8 pt-6 text-white shadow-xl"
        style={{ background: accent }}
      >
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-3">
            {payload.branding.logoUrl ? (
              <img
                src={payload.branding.logoUrl}
                alt=""
                className="h-12 w-12 rounded-2xl bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <ShoppingBag className="h-6 w-6" />
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-[0.2em] opacity-75">
                One code checkout
              </p>
              <h1 className="text-2xl font-black">
                {payload.branding.businessName}
              </h1>
              {payload.table ? (
                <p className="text-sm opacity-80">Table {payload.table.label}</p>
              ) : null}
            </div>
          </div>
          {payload.branding.reseller?.poweredBy ? (
            <p className="mt-4 text-xs opacity-75">
              {payload.branding.reseller.poweredBy}
            </p>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-md space-y-5 px-4 pt-5">
        {grouped.length === 0 ? (
          <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
            <p className="font-semibold">Menu is not available right now.</p>
          </div>
        ) : (
          grouped.map(([category, items]) => (
            <div key={category} className="space-y-3">
              <h2 className="px-1 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                {category}
              </h2>
              {items.map((item) => {
                const qty = quantityById[item.id] ?? 0;
                return (
                  <article
                    key={item.id}
                    className="rounded-3xl bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-slate-950">{item.name}</h3>
                        <p className="mt-1 font-mono text-sm text-slate-500">
                          {formatKes(item.price)}
                        </p>
                        {item.dietary.length ? (
                          <p className="mt-2 text-[10px] uppercase tracking-wider text-emerald-700">
                            {item.dietary.join(" • ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateQty(item, -1)}
                          disabled={qty === 0}
                          className="flex h-9 w-9 items-center justify-center rounded-full border disabled:opacity-30"
                          aria-label={`Remove ${item.name}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-5 text-center font-mono font-bold">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(item, 1)}
                          disabled={!item.available}
                          className="flex h-9 w-9 items-center justify-center rounded-full text-white disabled:opacity-30"
                          style={{ background: accent }}
                          aria-label={`Add ${item.name}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ))
        )}
      </section>

      <section className="fixed inset-x-0 bottom-0 border-t bg-white/95 p-4 shadow-2xl backdrop-blur">
        <div className="mx-auto max-w-md space-y-3">
          {loyalty?.enrolled ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span className="font-semibold text-amber-800">
                Welcome back{loyalty.name ? `, ${loyalty.name}` : ""}!
              </span>{" "}
              <span className="text-amber-700">
                {loyalty.points?.toLocaleString()} pts · {loyalty.tier}
              </span>
              {loyalty.nextTier ? (
                <span className="text-amber-600">
                  {" "}
                  · {loyalty.pointsToNext} to {loyalty.nextTier}
                </span>
              ) : null}
              {estPoints > 0 ? (
                <span className="text-amber-600"> · +{estPoints} this order</span>
              ) : null}
            </div>
          ) : estPoints > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              💛 Add your number to earn{" "}
              <span className="font-semibold">~{estPoints} points</span> &amp; join
              rewards.
            </div>
          ) : null}
          <div className="flex gap-2">
            <input
              value={promoInput}
              onChange={(event) =>
                setPromoInput(event.target.value.toUpperCase().slice(0, 24))
              }
              placeholder="Promo code"
              className="min-w-0 flex-1 rounded-2xl border bg-slate-50 px-3 py-2 text-sm uppercase outline-none"
            />
            <button
              type="button"
              onClick={() => void applyCode()}
              disabled={!promoInput.trim() || promoBusy || total <= 0}
              className="rounded-2xl border px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {promoBusy ? "…" : "Apply"}
            </button>
          </div>
          {promoResult ? (
            promoResult.valid ? (
              <p className="text-xs font-semibold text-emerald-600">
                🎉 −{formatKes(promoResult.discount)} off applied
              </p>
            ) : (
              <p className="text-xs text-red-600">{promoResult.reason}</p>
            )
          ) : null}
          <label className="flex items-center gap-2 rounded-2xl border bg-slate-50 px-3 py-2">
            <Phone className="h-4 w-4 text-slate-500" />
            <input
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value.replace(/[^0-9+]/g, "").slice(0, 13))
              }
              placeholder="Optional phone for loyalty"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              inputMode="tel"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="button"
            onClick={pay}
            disabled={total <= 0 || paying}
            className="flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-black text-white disabled:opacity-40"
            style={{ background: accent }}
          >
            {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {discount > 0 ? (
              <span>
                Pay{" "}
                <span className="line-through opacity-60">
                  {formatKes(total)}
                </span>{" "}
                {formatKes(payable)}
              </span>
            ) : (
              <span>Pay {formatKes(total)}</span>
            )}
          </button>
        </div>
      </section>
    </main>
  );
}
