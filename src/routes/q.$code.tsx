import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  CalendarDays,
  Check,
  Loader2,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  ShoppingBag,
} from "lucide-react";
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

// Mirrors src/lib/live-menu.ts. `priceMinor` is the only price this page
// spends: the whole QR/pay/ledger chain works in minor units.
type LiveMenuItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  priceMinor: number;
  currency: string;
  description: string | null;
  dietary: string[];
  allergens: string[];
  tags: string[];
  available: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
  videoUrl: string | null;
  videoDescription: string | null;
};

type LiveMenuSection = { name: string; items: LiveMenuItem[] };

type LiveMenu = {
  id: string;
  name: string;
  description: string | null;
  headerImageUrl: string | null;
  headerImageAlt: string | null;
  categories: LiveMenuSection[];
};

type ExternalMenu = { name: string; kind: "pdf" | "link"; url: string };

type LiveMenuPayload = {
  mode: "dynamic" | "external" | "none";
  external: ExternalMenu | null;
  languages: string[];
  defaultLanguage: string;
  lang: string | null;
  translated: boolean;
  menus: LiveMenu[];
  items: LiveMenuItem[];
  checkoutUpsell: { title: string; items: LiveMenuItem[] } | null;
};

type QrPayload = {
  venue: { id: string; name: string; timezone: string };
  branding: Branding;
  table: { id: string; label: string | null; section: string | null } | null;
  menu: LiveMenuPayload;
  items: LiveMenuItem[];
};

type CartItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
};

function formatKes(amount: number): string {
  return `KES ${(amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function groupedItems(items: LiveMenuItem[]): LiveMenuSection[] {
  const groups = new Map<string, LiveMenuItem[]>();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category)!.push(item);
  }
  return Array.from(groups.entries()).map(([name, list]) => ({
    name,
    items: list,
  }));
}

/**
 * The language menu shows endonyms where we know them, so a guest picks their
 * own language in their own language rather than reading an English label.
 */
function languageLabel(tag: string): string {
  try {
    const display = new Intl.DisplayNames([tag], { type: "language" });
    return display.of(tag) ?? tag.toUpperCase();
  } catch {
    return tag.toUpperCase();
  }
}

/**
 * One product card. Allergens, dietary flags and tags are rendered as WORDS,
 * never as a colour or an icon alone, and the image's alt text is the
 * merchant's own — both are conditions the server's projection guarantees.
 */
function ItemCard({
  item,
  qty,
  accent,
  onChange,
}: {
  item: LiveMenuItem;
  qty: number;
  accent: string;
  onChange: (item: LiveMenuItem, delta: number) => void;
}) {
  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-sm">
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={item.imageAlt ?? ""}
          loading="lazy"
          className="h-40 w-full object-cover"
        />
      ) : null}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-950">{item.name}</h3>
            {item.description ? (
              <p className="mt-1 text-sm text-slate-600">{item.description}</p>
            ) : null}
            <p className="mt-1 font-mono text-sm text-slate-500">
              {formatKes(item.priceMinor)}
            </p>
            {item.dietary.length ? (
              <p className="mt-2 text-[10px] uppercase tracking-wider text-emerald-700">
                {item.dietary.join(" • ")}
              </p>
            ) : null}
            {item.tags.length ? (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                {item.tags.join(" • ")}
              </p>
            ) : null}
            {item.allergens.length ? (
              <p className="mt-2 text-xs text-amber-800">
                <span className="font-semibold">Contains:</span>{" "}
                {item.allergens.join(", ")}
              </p>
            ) : null}
            {item.available ? null : (
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Unavailable right now
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onChange(item, -1)}
              disabled={qty === 0}
              className="flex h-11 w-11 items-center justify-center rounded-full border disabled:opacity-30"
              aria-label={`Remove one ${item.name}`}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-5 text-center font-mono font-bold" aria-hidden="true">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => onChange(item, 1)}
              disabled={!item.available}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white disabled:opacity-30"
              style={{ background: accent }}
              aria-label={`Add one ${item.name}. ${qty} in your order`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        {item.videoUrl ? (
          <a
            href={item.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-xs font-semibold text-slate-600 underline"
          >
            {item.videoDescription ?? `Watch a video of ${item.name}`}
          </a>
        ) : null}
      </div>
    </article>
  );
}

function UnifiedQrPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState<QrPayload | null>(null);
  // The menu lives beside the payload, not inside it: switching language
  // re-fetches the menu alone. Re-fetching /api/qr/:code would record a second
  // scan and inflate the scan count that walkout detection reads.
  const [menu, setMenu] = useState<LiveMenuPayload | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [cartUpsells, setCartUpsells] = useState<LiveMenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [phone, setPhone] = useState("");
  const [fulfillment, setFulfillment] = useState<"dine_in" | "collection">(
    "dine_in",
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promoResult, setPromoResult] = useState<{
    valid: boolean;
    discount: number;
    finalTotal: number;
    reason?: string;
  } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [showEnquiry, setShowEnquiry] = useState(false);
  const [enqName, setEnqName] = useState("");
  const [enqMsg, setEnqMsg] = useState("");
  const [serviceSent, setServiceSent] = useState<string | null>(null);
  const [serviceBusy, setServiceBusy] = useState(false);

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
          setMenu(data.menu);
          setLang(data.menu.lang);
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

  // C6.9-C6.11 — the merchant's published, in-window menus. Falls back to the
  // flat catalogue grouped by category when the venue has not enabled the
  // dynamic menu, so not opting in never costs a venue its menu.
  const visibleMenus = menu?.mode === "dynamic" ? menu.menus : [];
  const activeMenu =
    visibleMenus.find((entry) => entry.id === activeMenuId) ?? visibleMenus[0] ?? null;
  const sections = useMemo<LiveMenuSection[]>(() => {
    if (activeMenu) {
      return activeMenu.categories.filter((section) => section.items.length > 0);
    }
    return groupedItems(menu?.items ?? []);
  }, [activeMenu, menu]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    [cart],
  );
  const discount = promoResult?.valid ? promoResult.discount : 0;
  const payable = Math.max(0, total - discount);
  const estPoints = useMemo(() => loyaltyPointsFor(payable), [payable]);
  const venueId = payload?.venue.id;

  // A6.2/C6.13 — swap language without re-scanning. A failed switch keeps the
  // menu the guest is already reading rather than blanking it.
  async function switchLanguage(next: string | null) {
    if (!venueId || next === lang) return;
    setMenuBusy(true);
    try {
      const query = new URLSearchParams({ venue: venueId, surface: "qr" });
      if (next) query.set("lang", next);
      const res = await fetch(`/api/menu/live?${query.toString()}`);
      if (!res.ok) throw new Error("menu unavailable");
      const data = (await res.json()) as LiveMenuPayload;
      setMenu(data);
      setLang(data.lang);
    } catch {
      // Keep the current menu; the guest simply stays in the language they have.
    } finally {
      setMenuBusy(false);
    }
  }

  // Clear a stale promo when the cart changes; the guest re-applies against the new
  // subtotal (and the order handler re-validates server-side regardless).
  useEffect(() => {
    setPromoResult(null);
  }, [total]);

  // A counter/venue QR (no table) defaults to collection; a table QR to dine-in.
  useEffect(() => {
    if (payload && !payload.table) setFulfillment("collection");
  }, [payload]);

  // A6.6 — cart-level related products. The merchant's manual pairings come
  // first; the server tops the list up and hides anything unorderable or
  // photo-less, so this only ever renders a card it can actually draw.
  useEffect(() => {
    if (!venueId || cart.length === 0) {
      setCartUpsells([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/menu/recommend?venue=${encodeURIComponent(venueId)}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cart: cart.map(({ id, name }) => ({ id, name })),
          max: 3,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error("no recommendations");
          return (await res.json()) as {
            recommendations: Array<{ item: { id: string } }>;
          };
        })
        .then((data) => {
          if (cancelled) return;
          const byId = new Map((menu?.items ?? []).map((item) => [item.id, item]));
          const inCart = new Set(cart.map((entry) => entry.id));
          setCartUpsells(
            data.recommendations
              .map((entry) => byId.get(entry.item.id))
              .filter(
                (item): item is LiveMenuItem =>
                  Boolean(item) && !inCart.has(item!.id),
              ),
          );
        })
        .catch(() => {
          if (!cancelled) setCartUpsells([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [cart, menu, venueId]);

  const quantityById = useMemo(
    () =>
      cart.reduce<Record<string, number>>((acc, item) => {
        acc[item.id] = item.qty;
        return acc;
      }, {}),
    [cart],
  );

  function updateQty(item: LiveMenuItem, delta: number) {
    if (!item.available) return;
    setCart((current) => {
      const existing = current.find((entry) => entry.id === item.id);
      if (!existing && delta > 0) {
        return [
          ...current,
          { id: item.id, name: item.name, price: item.priceMinor, qty: 1 },
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

  // Remember the phone for order convenience only; it never unlocks identity data.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("pesaswap_phone");
    if (saved) setPhone(saved);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (phone.replace(/[^0-9]/g, "").length >= 9) {
      window.localStorage.setItem("pesaswap_phone", phone);
    }
  }, [phone]);

  async function requestBill() {
    if (!venueId) return;
    setServiceBusy(true);
    try {
      const who = payload?.table?.label ? `Table ${payload.table.label}` : "A guest";
      await fetch("/api/enquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venue: venueId,
          customerName: who,
          phone: phone.trim() || undefined,
          notes: "🔔 Bill / service requested from the table QR",
        }),
      });
      setServiceSent("A server is on the way — thank you! 🔔");
    } catch {
      setServiceSent("Couldn't reach the team — please flag a server.");
    } finally {
      setServiceBusy(false);
    }
  }

  async function sendEnquiry() {
    if (!venueId || !enqName.trim() || !enqMsg.trim()) return;
    setServiceBusy(true);
    try {
      await fetch("/api/enquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venue: venueId,
          customerName: enqName.trim(),
          phone: phone.trim() || undefined,
          notes: enqMsg.trim(),
        }),
      });
      setShowEnquiry(false);
      setEnqName("");
      setEnqMsg("");
      setServiceSent("Thanks! The team will get back to you.");
    } catch {
      setServiceSent("Couldn't send — please try again.");
    } finally {
      setServiceBusy(false);
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
          items: cart.map(({ id, qty }) => ({ id, qty })),
          phone: phone.trim() || undefined,
          promoCode: promoResult?.valid ? promoInput.trim() : undefined,
          fulfillmentType: fulfillment,
          scheduledAt: scheduledAt || undefined,
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
        <p role="status" aria-live="polite" className="sr-only">
          {menuBusy ? "Loading the menu…" : ""}
        </p>

        {menu && menu.languages.length > 0 ? (
          <div
            role="group"
            aria-label="Menu language"
            className="flex flex-wrap gap-2"
          >
            {[menu.defaultLanguage, ...menu.languages].map((tag) => {
              const isDefault = tag === menu.defaultLanguage;
              const selected = isDefault ? lang === null : lang === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  disabled={menuBusy}
                  onClick={() => void switchLanguage(isDefault ? null : tag)}
                  className={`min-h-11 rounded-full border px-4 text-sm font-semibold disabled:opacity-50 ${
                    selected ? "border-slate-900 bg-slate-900 text-white" : "bg-white"
                  }`}
                >
                  {languageLabel(tag)}
                </button>
              );
            })}
          </div>
        ) : null}

        {menu?.mode === "external" && menu.external ? (
          <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
            <p className="font-semibold text-slate-900">{menu.external.name}</p>
            <a
              href={menu.external.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-white"
              style={{ background: accent }}
            >
              {menu.external.kind === "pdf" ? "Open the menu (PDF)" : "Open the menu"}
            </a>
            <p className="mt-3 text-xs text-slate-500">
              Ordering from your phone isn't available at this venue yet — a
              server will take your order.
            </p>
          </div>
        ) : sections.length === 0 ? (
          <div className="rounded-3xl bg-white p-6 text-center shadow-sm">
            <p className="font-semibold">Menu is not available right now.</p>
          </div>
        ) : (
          <>
            {visibleMenus.length > 1 ? (
              <div
                role="group"
                aria-label="Menus"
                className="flex gap-2 overflow-x-auto pb-1"
              >
                {visibleMenus.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={entry.id === activeMenu?.id}
                    onClick={() => setActiveMenuId(entry.id)}
                    className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${
                      entry.id === activeMenu?.id
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "bg-white"
                    }`}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            ) : null}

            {activeMenu?.headerImageUrl ? (
              <img
                src={activeMenu.headerImageUrl}
                alt={activeMenu.headerImageAlt ?? ""}
                className="h-36 w-full rounded-3xl object-cover shadow-sm"
              />
            ) : null}
            {activeMenu?.description ? (
              <p className="px-1 text-sm text-slate-600">{activeMenu.description}</p>
            ) : null}

            {sections.map((section) => (
              <div key={section.name} className="space-y-3">
                <h2 className="px-1 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  {section.name}
                </h2>
                {section.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    qty={quantityById[item.id] ?? 0}
                    accent={accent}
                    onChange={updateQty}
                  />
                ))}
              </div>
            ))}
          </>
        )}

        {cartUpsells.length > 0 ? (
          <div className="space-y-3" aria-labelledby="cart-upsell-heading">
            <h2
              id="cart-upsell-heading"
              className="px-1 text-xs font-black uppercase tracking-[0.2em] text-slate-500"
            >
              Goes well with your order
            </h2>
            {cartUpsells.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                qty={quantityById[item.id] ?? 0}
                accent={accent}
                onChange={updateQty}
              />
            ))}
          </div>
        ) : null}

        {cart.length > 0 && menu?.checkoutUpsell ? (
          <div className="space-y-3" aria-labelledby="checkout-upsell-heading">
            <h2
              id="checkout-upsell-heading"
              className="px-1 text-xs font-black uppercase tracking-[0.2em] text-slate-500"
            >
              {menu.checkoutUpsell.title}
            </h2>
            {menu.checkoutUpsell.items
              .filter((item) => !quantityById[item.id])
              .map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  qty={quantityById[item.id] ?? 0}
                  accent={accent}
                  onChange={updateQty}
                />
              ))}
          </div>
        ) : null}
      </section>

      <section className="mx-auto mb-48 max-w-md px-4">
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-slate-900">Need anything?</p>
          {serviceSent ? (
            <p className="mt-2 rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {serviceSent}
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-3 gap-2">
            <a
              href={`/book/${encodeURIComponent(venueId ?? "")}`}
              className="flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-semibold text-slate-700"
            >
              <CalendarDays className="h-5 w-5" />
              Book a table
            </a>
            <button
              type="button"
              onClick={() => setShowEnquiry((s) => !s)}
              className="flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-semibold text-slate-700"
            >
              <MessageCircle className="h-5 w-5" />
              Ask us
            </button>
            <button
              type="button"
              onClick={() => void requestBill()}
              disabled={serviceBusy}
              className="flex flex-col items-center gap-1 rounded-2xl border p-3 text-xs font-semibold text-slate-700 disabled:opacity-40"
            >
              <Bell className="h-5 w-5" />
              Request bill
            </button>
          </div>
          {showEnquiry ? (
            <div className="mt-3 space-y-2">
              <input
                value={enqName}
                onChange={(event) => setEnqName(event.target.value)}
                placeholder="Your name"
                className="w-full rounded-2xl border bg-slate-50 px-3 py-2 text-sm outline-none"
              />
              <textarea
                value={enqMsg}
                onChange={(event) => setEnqMsg(event.target.value)}
                placeholder="Your question or request…"
                rows={3}
                className="w-full rounded-2xl border bg-slate-50 px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => void sendEnquiry()}
                disabled={serviceBusy || !enqName.trim() || !enqMsg.trim()}
                className="w-full rounded-2xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: accent }}
              >
                Send
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="fixed inset-x-0 bottom-0 max-h-[min(70dvh,36rem)] overflow-y-auto border-t bg-white/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur">
        <div className="mx-auto max-w-md space-y-3">
          {estPoints > 0 ? (
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
          <div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFulfillment("dine_in")}
                aria-pressed={fulfillment === "dine_in"}
                className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                  fulfillment === "dine_in"
                    ? "border-transparent text-white"
                    : "bg-slate-50 text-slate-600"
                }`}
                style={
                  fulfillment === "dine_in" ? { background: accent } : undefined
                }
              >
                🍽️ Eat in
              </button>
              <button
                type="button"
                onClick={() => setFulfillment("collection")}
                aria-pressed={fulfillment === "collection"}
                className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                  fulfillment === "collection"
                    ? "border-transparent text-white"
                    : "bg-slate-50 text-slate-600"
                }`}
                style={
                  fulfillment === "collection"
                    ? { background: accent }
                    : undefined
                }
              >
                🛍️ Collection
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setScheduledAt("")}
                aria-pressed={scheduledAt === ""}
                className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${
                  scheduledAt === "" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-600"
                }`}
              >
                ASAP
              </button>
              <input
                type="datetime-local"
                value={scheduledAt}
                min={(() => {
                  const date = new Date(Date.now() + 5 * 60_000);
                  const parts = new Intl.DateTimeFormat("en-CA", {
                    timeZone: payload?.venue.timezone ?? "Africa/Nairobi",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  }).formatToParts(date);
                  const part = (type: Intl.DateTimeFormatPartTypes) =>
                    parts.find((entry) => entry.type === type)?.value ?? "00";
                  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
                })()}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="min-w-0 flex-1 rounded-2xl border bg-slate-50 px-3 py-2 text-xs outline-none"
                aria-label="Pre-order for a later time"
              />
            </div>
          </div>
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
              autoComplete="tel"
              enterKeyHint="done"
            />
          </label>
          {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
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
