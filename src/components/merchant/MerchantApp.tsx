import { useState, useEffect, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  pesaswapClient,
  buildPaymentMetadata,
  type PaymentMetadata,
} from "../../lib/pesaswap-payments";
import {
  realtime,
  usePesaSwapEvent,
  usePesaSwapRealtime,
  type RealtimeEvent,
} from "../../lib/realtime";
import {
  Home,
  QrCode,
  FileText,
  ScanLine,
  Bell,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Check,
  Copy,
  Share2,
  X,
  Wallet,
  ClipboardPaste,
  ShieldCheck,
  Pencil,
  Repeat2,
  Send,
  Download,
  Clock3,
  CircleDollarSign,
  CalendarClock,
  Layers,
  Lock,
  Globe,
  MessageCircle,
  Brain,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Users,
  Smartphone,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Zap,
  Minus,
  Gift,
  Star,
  UtensilsCrossed,
  Wine,
  Leaf,
  Languages,
  Calendar,
} from "lucide-react";

type Tab = "home" | "invoice" | "scan" | "list" | "insights" | "wallets" | "tapgo" | "tables";

type InvoiceTimelineEvent = {
  label: string;
  at: string;
};

type PartialPayment = {
  id: string;
  amount: number;
  paidAt: string;
  paidVia: string;
};

type InstallmentPlan = {
  count: number;
  frequency: "Weekly" | "Bi-weekly" | "Monthly";
  installments: {
    number: number;
    amount: number;
    dueDate: string;
    status: "Paid" | "Due" | "Upcoming" | "Overdue";
    paidAt?: string;
  }[];
};

export type Invoice = {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  status: "Paid" | "Pending" | "Overdue" | "Partial";
  date: string;
  note?: string;
  paidAt?: string;
  paidVia?: string;
  recurring?: {
    frequency: string;
    nextDate: string;
  };
  lastReminder?: string;
  timeline?: InvoiceTimelineEvent[];
  payments?: PartialPayment[];
  installmentPlan?: InstallmentPlan;
  fxLock?: FxLock;
  deliveryChannel?: "email" | "whatsapp" | "sms" | "link";
  customerPhone?: string;
};

type FxLock = {
  rate: number;
  from: string;
  to: string;
  lockedAt: string;
  expiresAt: string;
  expired?: boolean;
};

type PaymentMethod = {
  id: string;
  name: string;
  icon: string;
  region: string[];
};

const LOCAL_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "mpesa", name: "M-Pesa", icon: "📱", region: ["KE", "TZ", "UG"] },
  { id: "airtel_money", name: "Airtel Money", icon: "📲", region: ["KE", "UG", "NG"] },
  { id: "bank_transfer", name: "Bank Transfer", icon: "🏦", region: ["GB", "US", "EU", "NG", "KE"] },
  { id: "pix", name: "PIX", icon: "⚡", region: ["BR"] },
  { id: "upi", name: "UPI", icon: "🇮🇳", region: ["IN"] },
  { id: "card", name: "Card (Visa/MC)", icon: "💳", region: ["US", "GB", "EU", "NG", "KE", "BR", "IN"] },
  { id: "ussd", name: "USSD", icon: "📞", region: ["NG"] },
  { id: "wise", name: "Wise Transfer", icon: "🌍", region: ["US", "GB", "EU"] },
  { id: "paypal", name: "PayPal", icon: "🅿️", region: ["US", "GB", "EU"] },
];

const FX_RATES: Record<string, Record<string, number>> = {
  USD: { EUR: 0.92, GBP: 0.79, KES: 129.5, NGN: 1580, BRL: 5.12, INR: 83.2 },
  EUR: { USD: 1.084, GBP: 0.858, KES: 140.8, NGN: 1718 },
  GBP: { USD: 1.264, EUR: 1.165, KES: 164.1, NGN: 2002 },
  KES: { USD: 0.0077, EUR: 0.0071, GBP: 0.0061 },
  NGN: { USD: 0.00063, EUR: 0.00058, GBP: 0.0005 },
};

function getPaymentMethodsForRegion(region: string): PaymentMethod[] {
  return LOCAL_PAYMENT_METHODS.filter((m) => m.region.includes(region));
}

function detectRegionFromCurrency(currency: string): string {
  const map: Record<string, string> = { USD: "US", EUR: "EU", GBP: "GB", KES: "KE", NGN: "NG", BRL: "BR", INR: "IN" };
  return map[currency] ?? "US";
}

function lockFxRate(from: string, to: string, hours = 48): FxLock {
  const rate = FX_RATES[from]?.[to] ?? FX_RATES[to]?.[from] ? (1 / (FX_RATES[to]?.[from] ?? 1)) : 1;
  const now = new Date();
  const expires = new Date(now);
  expires.setHours(expires.getHours() + hours);
  return {
    rate,
    from,
    to,
    lockedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

function fxLockTimeRemaining(lock: FxLock): string {
  const now = new Date().getTime();
  const exp = new Date(lock.expiresAt).getTime();
  const diff = exp - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function whatsAppLink(invoice: Invoice, payUrl: string): string {
  const text = encodeURIComponent(
    `Hi ${invoice.customer},\n\nYour invoice ${invoice.id} for ${invoice.currency} ${invoice.amount.toLocaleString()} is ready.\n\nPay here: ${payUrl}\n\n— Sent via FX Engine`
  );
  const phone = invoice.customerPhone ? invoice.customerPhone.replace(/[^0-9]/g, "") : "";
  return `https://wa.me/${phone}?text=${text}`;
}

function smsLink(invoice: Invoice, payUrl: string): string {
  const text = encodeURIComponent(
    `Invoice ${invoice.id}: ${invoice.currency} ${invoice.amount.toLocaleString()}. Pay: ${payUrl}`
  );
  const phone = invoice.customerPhone ?? "";
  return `sms:${phone}?body=${text}`;
}

const STORAGE_KEY = "fxengine.merchant.invoices";
const seed: Invoice[] = [
  {
    id: "INV-10241",
    customer: "Lumio Studios",
    amount: 1240,
    currency: "USD",
    status: "Paid",
    date: "Oct 24",
    paidVia: "Wise",
    paidAt: "2026-05-26T12:20:00.000Z",
    timeline: [
      { label: "Created", at: "2026-05-24T08:30:00.000Z" },
      { label: "QR shared", at: "2026-05-24T08:42:00.000Z" },
      { label: "Payment received", at: "2026-05-26T12:20:00.000Z" },
      { label: "Settled via Wise", at: "2026-05-26T12:38:00.000Z" },
    ],
  },
  {
    id: "INV-10240",
    customer: "Northwind GmbH",
    amount: 4820,
    currency: "EUR",
    status: "Pending",
    date: "Oct 23",
    recurring: { frequency: "Monthly", nextDate: "2026-06-23T09:00:00.000Z" },
    timeline: [
      { label: "Created", at: "2026-05-23T09:00:00.000Z" },
      { label: "QR shared", at: "2026-05-23T09:14:00.000Z" },
    ],
  },
  {
    id: "INV-10238",
    customer: "Acme Trading",
    amount: 920,
    currency: "GBP",
    status: "Overdue",
    date: "Oct 19",
    lastReminder: "2026-05-29T10:45:00.000Z",
    timeline: [
      { label: "Created", at: "2026-05-19T11:15:00.000Z" },
      { label: "QR shared", at: "2026-05-19T11:28:00.000Z" },
      { label: "Reminder sent", at: "2026-05-29T10:45:00.000Z" },
    ],
  },
  { id: "INV-10235", customer: "Brava Holdings", amount: 3100, currency: "USD", status: "Paid", date: "Oct 17", paidVia: "Currencycloud" },
  {
    id: "INV-10233",
    customer: "Safari Exports",
    amount: 5000,
    currency: "KES",
    status: "Partial",
    date: "Oct 15",
    payments: [
      { id: "PAY-a1", amount: 2000, paidAt: "2026-05-20T14:00:00.000Z", paidVia: "M-Pesa" },
      { id: "PAY-a2", amount: 1000, paidAt: "2026-05-27T09:30:00.000Z", paidVia: "Bank Transfer" },
    ],
    installmentPlan: {
      count: 3,
      frequency: "Monthly",
      installments: [
        { number: 1, amount: 2000, dueDate: "2026-05-20T00:00:00.000Z", status: "Paid", paidAt: "2026-05-20T14:00:00.000Z" },
        { number: 2, amount: 2000, dueDate: "2026-06-20T00:00:00.000Z", status: "Due" },
        { number: 3, amount: 1000, dueDate: "2026-07-20T00:00:00.000Z", status: "Upcoming" },
      ],
    },
    timeline: [
      { label: "Created", at: "2026-05-15T08:00:00.000Z" },
      { label: "QR shared", at: "2026-05-15T08:12:00.000Z" },
      { label: "Partial payment · KES 2,000", at: "2026-05-20T14:00:00.000Z" },
      { label: "Partial payment · KES 1,000", at: "2026-05-27T09:30:00.000Z" },
    ],
  },
];

function shiftTimestamp(base: string | Date, minutes: number) {
  const next = new Date(base);
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}

function nextRecurringDate(frequency: string, base = new Date()) {
  const next = new Date(base);
  const dayMap: Record<string, number> = {
    Weekly: 7,
    "Bi-weekly": 14,
    Monthly: 30,
  };
  next.setDate(next.getDate() + (dayMap[frequency] ?? 30));
  return next.toISOString();
}

function formatTimelineDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
  return `${Math.floor(diffMinutes / 1440)}d ago`;
}

function appendTimelineEvent(
  timeline: InvoiceTimelineEvent[] | undefined,
  event: InvoiceTimelineEvent,
) {
  const events = timeline ?? [];
  const existing = events.find((item) => item.label === event.label);
  const next = existing
    ? events.map((item) => (item.label === event.label ? event : item))
    : [...events, event];

  return [...next].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function timelineFor(invoice: Invoice) {
  let timeline = invoice.timeline ?? [];

  if (!timeline.some((event) => event.label === "Created")) {
    const createdAt = invoice.paidAt
      ? shiftTimestamp(invoice.paidAt, -60 * 24 * 2)
      : shiftTimestamp(new Date(), invoice.status === "Overdue" ? -60 * 24 * 4 : -90);
    timeline = appendTimelineEvent(timeline, { label: "Created", at: createdAt });
  }

  if (!timeline.some((event) => event.label === "QR shared")) {
    const createdAt = timeline.find((event) => event.label === "Created")?.at ?? new Date().toISOString();
    timeline = appendTimelineEvent(timeline, { label: "QR shared", at: shiftTimestamp(createdAt, 12) });
  }

  if (invoice.lastReminder) {
    timeline = appendTimelineEvent(timeline, { label: "Reminder sent", at: invoice.lastReminder });
  }

  if (invoice.status === "Paid") {
    const paymentAt =
      invoice.paidAt ?? shiftTimestamp(timeline.find((event) => event.label === "QR shared")?.at ?? new Date(), 95);
    timeline = appendTimelineEvent(timeline, { label: "Payment received", at: paymentAt });
    timeline = appendTimelineEvent(timeline, {
      label: `Settled via ${invoice.paidVia ?? "Wise"}`,
      at: shiftTimestamp(paymentAt, 18),
    });
  }

  return timeline;
}

function totalPaid(invoice: Invoice): number {
  return (invoice.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
}

function amountRemaining(invoice: Invoice): number {
  return Math.max(0, invoice.amount - totalPaid(invoice));
}

function generateInstallments(
  totalAmount: number,
  count: number,
  frequency: "Weekly" | "Bi-weekly" | "Monthly",
  startDate = new Date(),
): InstallmentPlan["installments"] {
  const perInstallment = Math.round((totalAmount / count) * 100) / 100;
  const dayMap: Record<string, number> = { Weekly: 7, "Bi-weekly": 14, Monthly: 30 };
  const days = dayMap[frequency];

  return Array.from({ length: count }, (_, i) => {
    const due = new Date(startDate);
    due.setDate(due.getDate() + days * (i + 1));
    const isFirst = i === 0;
    return {
      number: i + 1,
      amount: i === count - 1 ? Math.round((totalAmount - perInstallment * (count - 1)) * 100) / 100 : perInstallment,
      dueDate: due.toISOString(),
      status: isFirst ? "Due" as const : "Upcoming" as const,
    };
  });
}

function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    if (typeof window === "undefined") return seed;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Invoice[]) : seed;
    } catch {
      return seed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
    } catch {
      /* ignore */
    }
  }, [invoices]);

  return {
    invoices,
    add: (inv: Invoice) => setInvoices((prev) => [inv, ...prev]),
    markPaid: (id: string, via = "FX Engine") =>
      setInvoices((prev) =>
        prev.map((i) =>
          i.id === id
            ? (() => {
                const paidAt = new Date().toISOString();
                const baseTimeline = timelineFor(i);
                return {
                  ...i,
                  status: "Paid" as const,
                  paidAt,
                  paidVia: via,
                  timeline: appendTimelineEvent(
                    appendTimelineEvent(baseTimeline, { label: "Payment received", at: paidAt }),
                    { label: `Settled via ${via}`, at: shiftTimestamp(paidAt, 18) },
                  ),
                };
              })()
            : i,
        ),
      ),
    update: (id: string, patch: Partial<Invoice>) =>
      setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    recordPayment: (id: string, paymentAmount: number, via = "FX Engine") =>
      setInvoices((prev) =>
        prev.map((i) => {
          if (i.id !== id) return i;
          const payment: PartialPayment = {
            id: `PAY-${Date.now().toString(36)}`,
            amount: paymentAmount,
            paidAt: new Date().toISOString(),
            paidVia: via,
          };
          const updatedPayments = [...(i.payments ?? []), payment];
          const paid = updatedPayments.reduce((s, p) => s + p.amount, 0);
          const fullyPaid = paid >= i.amount;

          // Update installment plan if present
          let updatedPlan = i.installmentPlan;
          if (updatedPlan) {
            const nextDue = updatedPlan.installments.findIndex((inst) => inst.status === "Due" || inst.status === "Overdue");
            if (nextDue >= 0) {
              updatedPlan = {
                ...updatedPlan,
                installments: updatedPlan.installments.map((inst, idx) =>
                  idx === nextDue
                    ? { ...inst, status: "Paid" as const, paidAt: payment.paidAt }
                    : idx === nextDue + 1 && inst.status === "Upcoming"
                      ? { ...inst, status: "Due" as const }
                      : inst,
                ),
              };
            }
          }

          return {
            ...i,
            payments: updatedPayments,
            installmentPlan: updatedPlan,
            status: fullyPaid ? ("Paid" as const) : ("Partial" as const),
            paidAt: fullyPaid ? payment.paidAt : i.paidAt,
            paidVia: fullyPaid ? via : i.paidVia,
            timeline: appendTimelineEvent(timelineFor(i), {
              label: fullyPaid
                ? "Payment received (final)"
                : `Partial payment · ${i.currency} ${paymentAmount.toLocaleString()}`,
              at: payment.paidAt,
            }),
          };
        }),
      ),
    reset: () => setInvoices(seed),
  };
}

function payloadFor(inv: Invoice) {
  return JSON.stringify({
    type: "fx-engine/invoice",
    id: inv.id,
    amount: inv.amount,
    currency: inv.currency,
    customer: inv.customer,
    note: inv.note,
  });
}

function payLink(inv: Invoice) {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.origin + "/merchant");
  u.searchParams.set("pay", inv.id);
  return u.toString();
}

export function MerchantApp() {
  const ledger = useInvoices();
  const [tab, setTab] = useState<Tab>("home");
  const [showInvoice, setShowInvoice] = useState<Invoice | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);

  // Connect to PesaSwap real-time notifications
  useEffect(() => {
    realtime.connect(MERCHANT_NAME);
    return () => realtime.disconnect();
  }, []);

  // Real-time payment notifications
  useEffect(() => {
    const unsub1 = realtime.on("payment.succeeded", (event) => {
      if (event.type === "payment.succeeded") {
        const d = event.data;
        toast.success(
          `💰 Payment received: KES ${(d.amount / 100).toLocaleString()}`,
          {
            description: d.table_number
              ? `Table #${d.table_number} • ${d.customer_phone}`
              : d.customer_phone,
          },
        );
      }
    });

    const unsub2 = realtime.on("payment.refunded", (event) => {
      if (event.type === "payment.refunded") {
        const d = event.data;
        toast.info(`↩ Refund processed: KES ${(d.amount / 100).toLocaleString()}`, {
          description: `Reason: ${d.reason} • By: ${d.refunded_by}`,
        });
      }
    });

    const unsub3 = realtime.on("walkout.alert", (event) => {
      if (event.type === "walkout.alert") {
        const d = event.data;
        toast.error(`🚨 Walkout Alert — Table #${d.table_number}`, {
          description: `Outstanding: KES ${d.outstanding_amount.toLocaleString()}`,
          duration: 10000,
        });
      }
    });

    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  // keep the open detail sheet in sync with the canonical ledger record
  const detail = useMemo(
    () => (showInvoice ? ledger.invoices.find((i) => i.id === showInvoice.id) ?? showInvoice : null),
    [showInvoice, ledger.invoices],
  );
  const editingInvoice = useMemo(
    () => (editingInvoiceId ? ledger.invoices.find((i) => i.id === editingInvoiceId) ?? null : null),
    [editingInvoiceId, ledger.invoices],
  );

  function sendReminder(invoice: Invoice, silent = false) {
    const lastReminder = new Date().toISOString();
    ledger.update(invoice.id, {
      lastReminder,
      timeline: appendTimelineEvent(timelineFor(invoice), { label: "Reminder sent", at: lastReminder }),
    });
    if (!silent) toast.success(`Reminder sent to ${invoice.customer}`);
  }

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* status bar */}
      <div className="flex justify-between items-center px-6 pt-3 pb-1 text-[11px] font-mono">
        <span>9:41</span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 bg-accent rounded-full" />
          FXÂ·Live
        </span>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {tab === "home" && (
          <HomeView
            invoices={ledger.invoices}
            onOpen={setShowInvoice}
            onNew={() => setTab("invoice")}
            onScan={() => setTab("scan")}
          />
        )}
        {tab === "invoice" && (
          <InvoiceCreator
            onCreate={(inv) => {
              ledger.add(inv);
              toast.success("Invoice created", { description: `${inv.id} Â· ${inv.currency} ${inv.amount}` });
              setShowInvoice(inv);
              setTab("list");
            }}
          />
        )}
        {tab === "scan" && (
          <ScanView
            invoices={ledger.invoices}
            onDetected={(inv) => setPayTarget(inv)}
          />
        )}
        {tab === "list" && (
          <InvoiceListView
            invoices={ledger.invoices}
            onOpen={setShowInvoice}
            onMarkPaid={(id) => ledger.markPaid(id, "Batch")}
            onSendReminder={(id) => {
              const invoice = ledger.invoices.find((item) => item.id === id);
              if (invoice && invoice.status !== "Paid") sendReminder(invoice, true);
            }}
          />
        )}
        {tab === "insights" && (
         <AIInsightsView invoices={ledger.invoices} onOpen={setShowInvoice} />
        )}
        {tab === "wallets" && (
          <WalletReconciliationView invoices={ledger.invoices} />
        )}
        {tab === "tapgo" && (
          <TapGoPOS />
        )}
        {tab === "tables" && (
          <TableServiceView />
        )}
      </div>

      {/* bottom nav */}
      <nav className="absolute bottom-0 inset-x-0 border-t border-border bg-card/95 backdrop-blur px-2 py-2 grid grid-cols-6 gap-1 rounded-b-[2.4rem]">
        {[
         { id: "tapgo", icon: Zap, label: "Tap&Go" },
         { id: "tables", icon: Layers, label: "Tables" },
         { id: "home", icon: Home, label: "Home" },
         { id: "invoice", icon: FileText, label: "Invoice" },
         { id: "insights", icon: Brain, label: "AI" },
         { id: "list", icon: Wallet, label: "Ledger" },
        ].map((t) => {
         const active = tab === t.id;
         return (
           <button
             key={t.id}
             onClick={() => setTab(t.id as Tab)}
             className={`flex flex-col items-center gap-1 py-2 rounded-xl transition-colors ${
               active ? "bg-foreground text-background" : "text-muted-foreground"
             }`}
           >
             <t.icon className="size-4" />
             <span className="text-[9px] font-medium uppercase tracking-wider">{t.label}</span>
           </button>
         );
        })}
      </nav>

      {detail && (
        <InvoiceDetailSheet
          invoice={detail}
          onClose={() => setShowInvoice(null)}
          onEdit={() => setEditingInvoiceId(detail.id)}
          onMarkPaid={() => {
            ledger.markPaid(detail.id, "Manual");
            toast.success("Marked as paid", { description: detail.id });
          }}
          onSendReminder={() => sendReminder(detail)}
          onRecordPayment={(amount, via) => {
            ledger.recordPayment(detail.id, amount, via);
            toast.success("Payment recorded", {
              description: `${detail.currency} ${amount.toLocaleString()} via ${via}`,
            });
          }}
        />
      )}

      {editingInvoice && (
        <div className="absolute inset-0 z-50 flex items-end rounded-b-[2.4rem] overflow-hidden">
          <div className="absolute inset-0 bg-foreground/50" onClick={() => setEditingInvoiceId(null)} />
          <div className="relative w-full bg-card rounded-t-3xl pb-5 max-h-[92%] overflow-y-auto animate-slide-up">
            <InvoiceCreator
              mode="edit"
              initialInvoice={editingInvoice}
              onCancel={() => setEditingInvoiceId(null)}
              onCreate={(updatedInvoice) => {
                ledger.update(updatedInvoice.id, {
                  customer: updatedInvoice.customer,
                  amount: updatedInvoice.amount,
                  currency: updatedInvoice.currency,
                  note: updatedInvoice.note,
                  recurring: updatedInvoice.recurring,
                  timeline: appendTimelineEvent(timelineFor(editingInvoice), {
                    label: "Invoice updated",
                    at: new Date().toISOString(),
                  }),
                });
                toast.success("Invoice updated", { description: updatedInvoice.id });
                setEditingInvoiceId(null);
              }}
            />
          </div>
        </div>
      )}

      {payTarget && (
        <PaySheet
          invoice={payTarget}
          onClose={() => setPayTarget(null)}
          onConfirm={(provider) => {
            ledger.markPaid(payTarget.id, provider);
            toast.success(`Paid via ${provider}`, {
              description: `${payTarget.currency} ${payTarget.amount.toLocaleString()} Â· ${payTarget.id}`,
            });
            setPayTarget(null);
            setShowInvoice(payTarget);
          }}
        />
      )}
    </div>
  );
}

function HomeView({
  invoices,
  onOpen,
  onNew,
  onScan,
}: {
  invoices: Invoice[];
  onOpen: (i: Invoice) => void;
  onNew: () => void;
  onScan: () => void;
}) {
  const outstanding = invoices.filter((i) => i.status !== "Paid").reduce((s, i) => s + i.amount, 0);
  const counts = {
    paid: invoices.filter((i) => i.status === "Paid").length,
    pending: invoices.filter((i) => i.status === "Pending").length,
    partial: invoices.filter((i) => i.status === "Partial").length,
    overdue: invoices.filter((i) => i.status === "Overdue").length,
  };
  const currencyTotals = ["USD", "EUR", "GBP", "KES", "NGN"].map((currency) => ({
    currency,
    total: invoices
      .filter((i) => i.status !== "Paid" && i.currency === currency)
      .reduce((sum, i) => sum + i.amount, 0),
  }));
  const maxCurrencyTotal = Math.max(...currencyTotals.map((item) => item.total), 1);

  return (
    <div className="px-5 pt-3 space-y-5">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Merchant</p>
          <h1 className="text-lg font-bold">Sade's Atelier</h1>
        </div>
        <button className="size-9 rounded-full bg-muted flex items-center justify-center">
          <Bell className="size-4" />
        </button>
      </div>

      {/* balance card */}
      <div className="rounded-2xl bg-foreground text-background p-5 space-y-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">
            Outstanding receivables
          </p>
          <p className="text-3xl font-bold font-mono mt-1">
            ${outstanding.toLocaleString()}.00
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-background/10">
          <Stat label="Paid" value={String(counts.paid)} />
          <Stat label="Pending" value={String(counts.pending)} />
          <Stat label="Partial" value={String(counts.partial)} />
          <Stat label="Overdue" value={String(counts.overdue)} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Currency breakdown
            </p>
            <p className="text-xs font-semibold">Open invoice mix</p>
          </div>
          <Clock3 className="size-4 text-muted-foreground" />
        </div>
        <div className="space-y-3">
          {currencyTotals.map((item) => (
            <div key={item.currency} className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-mono font-semibold">{item.currency}</span>
                <span className="font-mono text-muted-foreground">{item.total.toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-foreground transition-all"
                  style={{ width: `${(item.total / maxCurrencyTotal) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* quick actions */}
      <div className="grid grid-cols-3 gap-3">
        <ActionTile icon={Plus} label="New invoice" onClick={onNew} primary />
        <ActionTile icon={QrCode} label="QR pay" onClick={onScan} />
        <ActionTile icon={ScanLine} label="Scan" onClick={onScan} />
      </div>

      {/* activity */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Recent activity
          </h2>
          <button className="text-[11px] text-accent font-medium">See all</button>
        </div>
        <div className="space-y-2">
          {invoices.slice(0, 4).map((i) => (
            <InvoiceRow key={i.id} invoice={i} onClick={() => onOpen(i)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-base font-bold font-mono">{value}</p>
      <p className="text-[9px] uppercase tracking-widest opacity-60">{label}</p>
    </div>
  );
}

function ActionTile({
  icon: Icon,
  label,
  onClick,
  primary,
}: {
  icon: typeof Plus;
  label: string;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`aspect-square rounded-2xl flex flex-col items-center justify-center gap-2 border transition-colors ${
        primary
          ? "bg-accent text-accent-foreground border-accent"
          : "bg-card border-border hover:bg-muted"
      }`}
    >
      <Icon className="size-5" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function InvoiceRow({
 invoice,
 onClick,
 selectable,
 selected,
}: {
 invoice: Invoice;
 onClick: () => void;
 selectable?: boolean;
 selected?: boolean;
}) {
 const map: Record<Invoice["status"], string> = {
   Paid: "bg-emerald-50 text-emerald-700",
   Pending: "bg-amber-50 text-amber-700",
   Overdue: "bg-red-50 text-red-700",
   Partial: "bg-blue-50 text-blue-700",
 };
  const Icon = invoice.status === "Paid" ? ArrowDownLeft : ArrowUpRight;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left"
    >
      {selectable && (
        <div
          className={`size-4 rounded-md border flex items-center justify-center ${
            selected ? "bg-foreground border-foreground text-background" : "border-border bg-background"
          }`}
        >
          {selected ? <Check className="size-3" /> : null}
        </div>
      )}
      <div className="size-9 rounded-full bg-muted flex items-center justify-center">
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{invoice.customer}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-[10px] font-mono text-muted-foreground">
            {invoice.id} · {invoice.date}
          </p>
          {invoice.recurring && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
              <Repeat2 className="size-3" />
              {invoice.recurring.frequency}
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-bold font-mono">
          {invoice.currency} {invoice.amount.toLocaleString()}
        </p>
        <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight ${map[invoice.status]}`}>
          {invoice.status}
        </span>
      </div>
    </button>
  );
}

// ─── TAP & GO POS ─────────────────────────────────────────────────────────────

type TapGoTransaction = {
  id: string;
  amount: number;
  customerPhone: string;
  status: "pending" | "confirmed" | "failed";
  timestamp: string;
  method: "STK Push" | "QR Scan";
};

const TILL_NUMBER = "247365";
const MERCHANT_NAME = "Sade's Atelier";

function TapGoPOS() {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"keypad" | "qr" | "waiting" | "success">("keypad");
  const [transactions, setTransactions] = useState<TapGoTransaction[]>([]);
  const [currentTx, setCurrentTx] = useState<TapGoTransaction | null>(null);
  const [customerNumber, setCustomerNumber] = useState("");

  const qrPayload = JSON.stringify({
    type: "pesaswap/tapgo",
    till: TILL_NUMBER,
    merchant: MERCHANT_NAME,
    amount: Number(amount),
    ref: `TG-${Date.now().toString(36).toUpperCase()}`,
    ts: Date.now(),
  });

  const payUrl = typeof window !== "undefined"
    ? `${window.location.origin}/pay?tapgo=${encodeURIComponent(btoa(JSON.stringify({ till: TILL_NUMBER, amount: Number(amount), merchant: MERCHANT_NAME })))}`
    : "";

  function initiatePayment() {
    if (!amount || Number(amount) <= 0) return;
    const tx: TapGoTransaction = {
      id: `TG-${Date.now().toString(36).toUpperCase()}`,
      amount: Number(amount),
      customerPhone: "",
      status: "pending",
      timestamp: new Date().toISOString(),
      method: "QR Scan",
    };
    setCurrentTx(tx);
    setMode("qr");
  }

  async function simulatePaymentReceived(phone?: string) {
    if (!currentTx) return;
    setMode("waiting");

    try {
      // Create a real payment intent via PesaSwap backend
      const metadata = buildPaymentMetadata({
        merchant: { name: MERCHANT_NAME, till: TILL_NUMBER },
        flow: "tapgo",
        customer: { phone: phone || "0722000000" },
      });

      const payment = await pesaswapClient.createPayment({
        amount: currentTx.amount * 100, // minor units
        currency: "KES",
        description: `Tap&Go payment to ${MERCHANT_NAME}`,
        metadata: metadata,
      });

      // Payment created — now wait for customer confirmation via webhook/realtime
      // For now, mark as confirmed (webhook will update in real-time)
      const completedTx: TapGoTransaction = {
        ...currentTx,
        id: payment.payment_id || currentTx.id,
        status: "confirmed",
        method: phone ? "STK Push" : "QR Scan",
        customerPhone: phone
          ? phone.slice(0, 4) + "***" + phone.slice(-3)
          : "0722***" + Math.floor(100 + Math.random() * 900),
      };
      setTransactions((prev) => [completedTx, ...prev]);
      setCurrentTx(completedTx);
      setMode("success");
      setTimeout(() => {
        setMode("keypad");
        setAmount("");
        setCurrentTx(null);
        setCustomerNumber("");
      }, 3000);
    } catch (err) {
      toast.error("Payment failed: " + (err instanceof Error ? err.message : "Unknown error"));
      setMode("keypad");
    }
  }

  const todayTotal = transactions.filter((t) => t.status === "confirmed").reduce((s, t) => s + t.amount, 0);
  const todayCount = transactions.filter((t) => t.status === "confirmed").length;
  const avgTime = 8; // seconds (simulated)

  if (mode === "success" && currentTx) {
    return (
      <div className="px-5 pt-3 flex flex-col items-center justify-center h-full space-y-4">
        <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce">
          <CheckCircle2 className="size-10 text-emerald-600" />
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold font-mono">KES {currentTx.amount.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground mt-1">Payment confirmed</p>
          <p className="text-[10px] font-mono text-muted-foreground mt-2">
            {currentTx.customerPhone} · {currentTx.id}
          </p>
        </div>
        <div className="flex items-center gap-2 text-emerald-600">
          <Clock3 className="size-4" />
          <span className="text-sm font-mono font-bold">{avgTime}s</span>
          <span className="text-xs text-muted-foreground">checkout time</span>
        </div>
      </div>
    );
  }

  if (mode === "waiting") {
    return (
      <div className="px-5 pt-3 flex flex-col items-center justify-center h-full space-y-4">
        <div className="size-16 rounded-full border-4 border-foreground border-t-transparent animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold">Waiting for payment...</p>
          <p className="text-[11px] text-muted-foreground mt-1">STK push sent to customer</p>
          <p className="text-2xl font-bold font-mono mt-3">KES {currentTx?.amount.toLocaleString()}</p>
        </div>
      </div>
    );
  }

  if (mode === "qr") {
    return (
      <div className="px-5 pt-3 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Tap & Go</p>
            <h1 className="text-lg font-bold">Collect KES {Number(amount).toLocaleString()}</h1>
          </div>
          <button
            onClick={() => { setMode("keypad"); setCurrentTx(null); setCustomerNumber(""); }}
            className="size-8 rounded-full bg-muted flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rounded-2xl bg-foreground text-background p-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Amount to pay</p>
          <p className="text-3xl font-bold font-mono mt-1">KES {Number(amount).toLocaleString()}</p>
          <p className="text-[10px] opacity-60 mt-1">Till {TILL_NUMBER} · {MERCHANT_NAME}</p>
        </div>

        {/* Option 1: QR Code */}
        <div className="rounded-2xl border border-border bg-background p-4 flex flex-col items-center gap-2">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Option 1 · Customer scans QR</p>
          <QRCodeSVG
            value={payUrl || qrPayload}
            size={160}
            level="M"
            bgColor="transparent"
            fgColor="oklch(0.22 0 0)"
          />
          <p className="text-[9px] font-mono text-muted-foreground text-center">
            Scan with camera or PesaSwap app
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[9px] font-mono uppercase text-muted-foreground">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Option 2: Enter phone number → STK push */}
        <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Option 2 · Enter phone → STK push</p>
          <div className="flex gap-2">
            <div className="rounded-xl border border-border bg-muted px-3 py-3 flex items-center">
              <span className="text-sm font-mono font-bold">+254</span>
            </div>
            <input
              type="tel"
              value={customerNumber}
              onChange={(e) => setCustomerNumber(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
              placeholder="7XX XXX XXX"
              className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-foreground"
            />
          </div>
          <button
            disabled={customerNumber.length < 9}
            onClick={() => {
              simulatePaymentReceived(`0${customerNumber}`);
            }}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Send className="size-4" />
            Send STK push to 0{customerNumber || "7XX..."}
          </button>
          <p className="text-[8px] text-center text-muted-foreground">
            Customer receives M-Pesa prompt → enters PIN → done
          </p>
        </div>

        <button
          onClick={() => simulatePaymentReceived()}
          className="w-full border border-border py-3 rounded-xl text-xs font-mono text-muted-foreground flex items-center justify-center gap-2"
        >
          <Zap className="size-3.5" />
          Simulate payment received (demo)
        </button>
      </div>
    );
  }

  // Keypad mode (default)
  return (
    <div className="px-5 pt-3 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Tap & Go POS</p>
          <h1 className="text-lg font-bold">Enter amount</h1>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-mono text-muted-foreground">Till {TILL_NUMBER}</p>
          <p className="text-[9px] font-mono text-emerald-600">● Live</p>
        </div>
      </div>

      {/* Amount Display */}
      <div className="rounded-2xl bg-muted p-6 text-center">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">KES</p>
        <p className="text-5xl font-bold font-mono mt-1">
          {amount ? Number(amount).toLocaleString() : "0"}
        </p>
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((key) => (
          <button
            key={key}
            onClick={() => {
              if (key === "⌫") setAmount((v) => v.slice(0, -1));
              else if (key === "." && amount.includes(".")) return;
              else setAmount((v) => v + key);
            }}
            className="py-4 rounded-xl bg-card border border-border text-lg font-mono font-bold hover:bg-muted active:bg-foreground active:text-background transition-colors"
          >
            {key}
          </button>
        ))}
      </div>

      {/* Generate QR Button */}
      <button
        disabled={!amount || Number(amount) <= 0}
        onClick={initiatePayment}
        className="w-full bg-foreground text-background py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <QrCode className="size-5" />
        Generate payment QR
      </button>

      {/* Today's Stats */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2 text-center">
            <p className="text-sm font-bold font-mono text-emerald-700">KES {(todayTotal / 1000).toFixed(1)}k</p>
            <p className="text-[8px] font-mono uppercase text-emerald-600">Today</p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-2 text-center">
            <p className="text-sm font-bold font-mono text-blue-700">{todayCount}</p>
            <p className="text-[8px] font-mono uppercase text-blue-600">Txns</p>
          </div>
          <div className="rounded-xl bg-purple-50 border border-purple-200 p-2 text-center">
            <p className="text-sm font-bold font-mono text-purple-700">{avgTime}s</p>
            <p className="text-[8px] font-mono uppercase text-purple-600">Avg time</p>
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Recent</p>
          {transactions.slice(0, 3).map((tx) => (
            <div key={tx.id} className="flex items-center justify-between p-2.5 rounded-xl bg-card border border-border">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <div>
                  <p className="text-[11px] font-mono font-bold">KES {tx.amount.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground">{tx.customerPhone}</p>
                </div>
              </div>
              <p className="text-[9px] font-mono text-muted-foreground">
                {new Date(tx.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MULTI-WALLET RECONCILIATION ENGINE ───────────────────────────────────────

type WalletProvider = {
  id: string;
  name: string;
  icon: string;
  color: string;
  bgColor: string;
  connected: boolean;
  balance: number;
  currency: string;
  lastSync: string;
  txCount: number;
};

type WalletTransaction = {
  id: string;
  wallet: string;
  type: "credit" | "debit";
  amount: number;
  currency: string;
  from: string;
  reference: string;
  timestamp: string;
  matched: boolean;
  matchedInvoiceId?: string;
  status: "confirmed" | "pending" | "failed";
};

const WALLET_PROVIDERS: WalletProvider[] = [
  { id: "mpesa", name: "M-Pesa", icon: "🟢", color: "text-green-700", bgColor: "bg-green-50", connected: true, balance: 45200, currency: "KES", lastSync: "2 min ago", txCount: 23 },
  { id: "mtn_momo", name: "MTN MoMo", icon: "🟡", color: "text-yellow-700", bgColor: "bg-yellow-50", connected: true, balance: 1280000, currency: "NGN", lastSync: "5 min ago", txCount: 12 },
  { id: "airtel", name: "Airtel Money", icon: "🔴", color: "text-red-700", bgColor: "bg-red-50", connected: true, balance: 8400, currency: "KES", lastSync: "12 min ago", txCount: 7 },
  { id: "bank", name: "Bank (KCB)", icon: "🏦", color: "text-blue-700", bgColor: "bg-blue-50", connected: true, balance: 234500, currency: "KES", lastSync: "1 hr ago", txCount: 5 },
  { id: "wise", name: "Wise", icon: "🌍", color: "text-emerald-700", bgColor: "bg-emerald-50", connected: false, balance: 0, currency: "USD", lastSync: "—", txCount: 0 },
];

function generateWalletTransactions(invoices: Invoice[]): WalletTransaction[] {
  const txs: WalletTransaction[] = [
    { id: "TX-001", wallet: "mpesa", type: "credit", amount: 2500, currency: "KES", from: "0722***456", reference: "QJ4K8M2N", timestamp: "2026-05-30T14:22:00.000Z", matched: true, matchedInvoiceId: "INV-10233", status: "confirmed" },
    { id: "TX-002", wallet: "mpesa", type: "credit", amount: 1800, currency: "KES", from: "0733***789", reference: "MK9P3L7R", timestamp: "2026-05-30T13:45:00.000Z", matched: false, status: "confirmed" },
    { id: "TX-003", wallet: "mtn_momo", type: "credit", amount: 450000, currency: "NGN", from: "080***1234", reference: "MTN-8847291", timestamp: "2026-05-30T12:30:00.000Z", matched: true, matchedInvoiceId: "INV-10240", status: "confirmed" },
    { id: "TX-004", wallet: "mpesa", type: "credit", amount: 5000, currency: "KES", from: "0711***222", reference: "PL2M9K4X", timestamp: "2026-05-30T11:15:00.000Z", matched: true, matchedInvoiceId: "INV-10233", status: "confirmed" },
    { id: "TX-005", wallet: "airtel", type: "credit", amount: 3200, currency: "KES", from: "0734***567", reference: "AIR-662841", timestamp: "2026-05-30T10:50:00.000Z", matched: false, status: "confirmed" },
    { id: "TX-006", wallet: "mtn_momo", type: "credit", amount: 125000, currency: "NGN", from: "070***5678", reference: "MTN-9912034", timestamp: "2026-05-30T09:20:00.000Z", matched: false, status: "pending" },
    { id: "TX-007", wallet: "bank", type: "credit", amount: 15000, currency: "KES", from: "KCB REF 44821", reference: "BNK-44821", timestamp: "2026-05-30T08:00:00.000Z", matched: true, matchedInvoiceId: "INV-10238", status: "confirmed" },
    { id: "TX-008", wallet: "mpesa", type: "debit", amount: 500, currency: "KES", from: "Float withdrawal", reference: "WD-8844", timestamp: "2026-05-30T07:30:00.000Z", matched: true, status: "confirmed" },
  ];
  return txs;
}

function WalletReconciliationView({ invoices }: { invoices: Invoice[] }) {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const transactions = useMemo(() => generateWalletTransactions(invoices), [invoices]);

  const connectedWallets = WALLET_PROVIDERS.filter((w) => w.connected);
  const totalBalance = connectedWallets.reduce((sum, w) => {
    // Normalize to KES for display
    const rate = w.currency === "KES" ? 1 : w.currency === "NGN" ? 0.082 : w.currency === "USD" ? 129.5 : 1;
    return sum + w.balance * rate;
  }, 0);

  const matchedCount = transactions.filter((t) => t.matched).length;
  const unmatchedCount = transactions.filter((t) => !t.matched).length;
  const filteredTxs = transactions.filter((t) => {
    if (selectedWallet && t.wallet !== selectedWallet) return false;
    if (showUnmatched && t.matched) return false;
    return true;
  });

  return (
    <div className="px-5 pt-3 space-y-5">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Reconciliation</p>
          <h1 className="text-lg font-bold">Multi-Wallet Hub</h1>
        </div>
        <button className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1">
          <RefreshCw className="size-3 text-emerald-600" />
          <span className="text-[9px] font-mono text-emerald-700 uppercase">Sync all</span>
        </button>
      </div>

      {/* Consolidated Balance */}
      <div className="rounded-2xl bg-foreground text-background p-5 text-center">
        <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Consolidated balance</p>
        <p className="text-3xl font-bold font-mono mt-1">KES {totalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        <p className="text-[10px] opacity-60 mt-1">
          Across {connectedWallets.length} connected wallets
        </p>
      </div>

      {/* Reconciliation Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
          <CheckCircle2 className="size-4 text-emerald-600 mx-auto" />
          <p className="text-lg font-bold font-mono text-emerald-700 mt-1">{matchedCount}</p>
          <p className="text-[8px] font-mono uppercase text-emerald-600">Matched</p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
          <AlertTriangle className="size-4 text-amber-600 mx-auto" />
          <p className="text-lg font-bold font-mono text-amber-700 mt-1">{unmatchedCount}</p>
          <p className="text-[8px] font-mono uppercase text-amber-600">Unmatched</p>
        </div>
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-center">
          <Zap className="size-4 text-blue-600 mx-auto" />
          <p className="text-lg font-bold font-mono text-blue-700 mt-1">{Math.round((matchedCount / transactions.length) * 100)}%</p>
          <p className="text-[8px] font-mono uppercase text-blue-600">Auto-match</p>
        </div>
      </div>

      {/* Connected Wallets */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Connected wallets
        </p>
        <div className="space-y-2">
          {WALLET_PROVIDERS.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => setSelectedWallet(selectedWallet === wallet.id ? null : wallet.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                selectedWallet === wallet.id ? "border-foreground bg-muted" :
                wallet.connected ? "border-border hover:bg-muted" : "border-dashed border-border opacity-50"
              }`}
            >
              <span className="text-lg">{wallet.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold">{wallet.name}</p>
                  {wallet.connected && (
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                  )}
                </div>
                <p className="text-[9px] font-mono text-muted-foreground">
                  {wallet.connected ? `Synced ${wallet.lastSync} · ${wallet.txCount} txns today` : "Not connected"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-mono font-bold">
                  {wallet.connected ? `${wallet.currency} ${wallet.balance.toLocaleString()}` : "—"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Transaction Feed */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Transaction feed
          </p>
          <button
            onClick={() => setShowUnmatched((v) => !v)}
            className={`text-[9px] font-mono uppercase px-2 py-1 rounded-full border transition-colors ${
              showUnmatched ? "bg-amber-100 border-amber-300 text-amber-700" : "border-border text-muted-foreground"
            }`}
          >
            {showUnmatched ? "Unmatched only" : "All"}
          </button>
        </div>
        <div className="space-y-2">
          {filteredTxs.map((tx) => {
            const wallet = WALLET_PROVIDERS.find((w) => w.id === tx.wallet);
            return (
              <div
                key={tx.id}
                className={`p-3 rounded-xl border ${
                  tx.matched ? "border-border bg-card" : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{wallet?.icon}</span>
                    <div>
                      <p className="text-[11px] font-semibold">{tx.from}</p>
                      <p className="text-[9px] font-mono text-muted-foreground">{tx.reference}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-[11px] font-mono font-bold ${tx.type === "credit" ? "text-emerald-600" : "text-red-600"}`}>
                      {tx.type === "credit" ? "+" : "-"}{tx.currency} {tx.amount.toLocaleString()}
                    </p>
                    <p className="text-[8px] font-mono text-muted-foreground">
                      {new Date(tx.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                  {tx.matched ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-emerald-600">
                      <CheckCircle2 className="size-3" />
                      Matched → {tx.matchedInvoiceId}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-amber-600">
                      <AlertTriangle className="size-3" />
                      Unmatched — tap to reconcile
                    </span>
                  )}
                  <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full ${
                    tx.status === "confirmed" ? "bg-emerald-100 text-emerald-700" :
                    tx.status === "pending" ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {tx.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Auto-reconciliation rules */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Auto-match rules
        </p>
        <div className="space-y-2">
          {[
            { rule: "Match by invoice reference in payment note", active: true, matches: 4 },
            { rule: "Match by exact amount + customer phone", active: true, matches: 2 },
            { rule: "Match by amount ±5% within 24h of due date", active: true, matches: 1 },
            { rule: "Flag duplicate payments (same amount, same day)", active: false, matches: 0 },
          ].map((r) => (
            <div key={r.rule} className="flex items-center gap-3 p-2 rounded-lg bg-muted">
              <span className={`size-2 rounded-full ${r.active ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium truncate">{r.rule}</p>
              </div>
              <span className="text-[9px] font-mono text-muted-foreground">{r.matches} hits</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── AI INSIGHTS ENGINE ───────────────────────────────────────────────────────

type CustomerScore = {
  name: string;
  grade: "A" | "B" | "C";
  avgDaysToPay: number;
  totalInvoices: number;
  totalRevenue: number;
  onTimeRate: number;
};

type PaymentPrediction = {
  invoiceId: string;
  customer: string;
  predictedDays: number;
  confidence: number;
  amount: number;
  currency: string;
};

type ChaseStep = {
  day: number;
  tone: "gentle" | "firm" | "urgent" | "final";
  label: string;
  sent?: boolean;
};

const CHASE_SEQUENCE: ChaseStep[] = [
  { day: 1, tone: "gentle", label: "Friendly reminder" },
  { day: 7, tone: "firm", label: "Follow-up notice" },
  { day: 14, tone: "urgent", label: "Urgent: payment overdue" },
  { day: 21, tone: "final", label: "Final notice before escalation" },
];

function computeCustomerScores(invoices: Invoice[]): CustomerScore[] {
  const customers = new Map<string, { paid: number[]; total: number; revenue: number; onTime: number }>();

  invoices.forEach((inv) => {
    if (!customers.has(inv.customer)) {
     customers.set(inv.customer, { paid: [], total: 0, revenue: 0, onTime: 0 });
    }
    const c = customers.get(inv.customer)!;
    c.total++;
    c.revenue += inv.amount;
    if (inv.status === "Paid" && inv.paidAt) {
     const created = inv.timeline?.[0]?.at;
     if (created) {
       const days = Math.max(1, Math.round((new Date(inv.paidAt).getTime() - new Date(created).getTime()) / 86400000));
       c.paid.push(days);
       if (days <= 7) c.onTime++;
     }
    }
  });

  return Array.from(customers.entries()).map(([name, data]) => {
    const avgDays = data.paid.length > 0 ? Math.round(data.paid.reduce((a, b) => a + b, 0) / data.paid.length) : 14;
    const onTimeRate = data.total > 0 ? data.onTime / data.total : 0;
    const grade: "A" | "B" | "C" = avgDays <= 5 && onTimeRate >= 0.8 ? "A" : avgDays <= 14 ? "B" : "C";
    return { name, grade, avgDaysToPay: avgDays, totalInvoices: data.total, totalRevenue: data.revenue, onTimeRate };
  });
}

function computePredictions(invoices: Invoice[], scores: CustomerScore[]): PaymentPrediction[] {
  const pending = invoices.filter((i) => i.status === "Pending" || i.status === "Overdue" || i.status === "Partial");
  return pending.map((inv) => {
    const score = scores.find((s) => s.name === inv.customer);
    const baseDays = score?.avgDaysToPay ?? 10;
    const jitter = Math.round((Math.random() - 0.5) * 3);
    const predictedDays = Math.max(1, baseDays + jitter);
    const confidence = score ? Math.min(95, 60 + score.totalInvoices * 10) : 45;
    return { invoiceId: inv.id, customer: inv.customer, predictedDays, confidence, amount: inv.amount, currency: inv.currency };
  });
}

function computeCashFlowForecast(invoices: Invoice[], predictions: PaymentPrediction[]): { day: string; amount: number }[] {
  const forecast: { day: string; amount: number }[] = [];
  const today = new Date();
  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dayLabel = d === 0 ? "Today" : d === 1 ? "Tomorrow" : date.toLocaleDateString("en-US", { weekday: "short" });
    const expectedAmount = predictions
     .filter((p) => p.predictedDays >= d && p.predictedDays < d + 2)
     .reduce((sum, p) => sum + p.amount, 0);
    forecast.push({ day: dayLabel, amount: expectedAmount });
  }
  return forecast;
}

function getChaseStatus(invoice: Invoice): { currentStep: number; nextAction: ChaseStep | null; daysOverdue: number } {
  const created = invoice.timeline?.[0]?.at;
  if (!created) return { currentStep: 0, nextAction: CHASE_SEQUENCE[0], daysOverdue: 0 };
  const days = Math.round((Date.now() - new Date(created).getTime()) / 86400000);
  const reminders = (invoice.timeline ?? []).filter((e) => e.label.includes("Reminder") || e.label.includes("reminder")).length;
  const currentStep = Math.min(reminders, CHASE_SEQUENCE.length - 1);
  const nextAction = currentStep < CHASE_SEQUENCE.length - 1 ? CHASE_SEQUENCE[currentStep + 1] : null;
  return { currentStep, nextAction, daysOverdue: days };
}

function AIInsightsView({ invoices, onOpen }: { invoices: Invoice[]; onOpen: (inv: Invoice) => void }) {
  const scores = useMemo(() => computeCustomerScores(invoices), [invoices]);
  const predictions = useMemo(() => computePredictions(invoices, scores), [invoices, scores]);
  const forecast = useMemo(() => computeCashFlowForecast(invoices, predictions), [invoices, predictions]);
  const maxForecast = Math.max(...forecast.map((f) => f.amount), 1);

  const pendingInvoices = invoices.filter((i) => i.status === "Pending" || i.status === "Overdue" || i.status === "Partial");
  const avgDSO = scores.length > 0
    ? Math.round(scores.reduce((s, c) => s + c.avgDaysToPay, 0) / scores.length)
    : 0;

  return (
    <div className="px-5 pt-3 space-y-5">
     <div className="flex justify-between items-start">
       <div>
         <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">AI Insights</p>
         <h1 className="text-lg font-bold">Intelligence Hub</h1>
       </div>
       <div className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-1">
         <Brain className="size-3 text-purple-600" />
         <span className="text-[9px] font-mono text-purple-700 uppercase">Live</span>
       </div>
     </div>

     {/* DSO Metric */}
     <div className="grid grid-cols-3 gap-2">
       <div className="rounded-xl bg-muted p-3 text-center">
         <p className="text-[9px] font-mono uppercase text-muted-foreground">Avg DSO</p>
         <p className="text-xl font-bold font-mono">{avgDSO}d</p>
       </div>
       <div className="rounded-xl bg-muted p-3 text-center">
         <p className="text-[9px] font-mono uppercase text-muted-foreground">At risk</p>
         <p className="text-xl font-bold font-mono text-amber-600">
           {pendingInvoices.filter((i) => i.status === "Overdue").length}
         </p>
       </div>
       <div className="rounded-xl bg-muted p-3 text-center">
         <p className="text-[9px] font-mono uppercase text-muted-foreground">Score avg</p>
         <p className="text-xl font-bold font-mono">
           {scores.length > 0 ? (scores.filter(s => s.grade === "A").length > scores.length / 2 ? "A" : scores.filter(s => s.grade === "C").length > scores.length / 2 ? "C" : "B") : "—"}
         </p>
       </div>
     </div>

     {/* Cash Flow Forecast */}
     <div className="rounded-2xl border border-border bg-background p-4">
       <div className="flex items-center gap-2 mb-3">
         <BarChart3 className="size-3.5 text-purple-500" />
         <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
           7-day cash flow forecast
         </p>
       </div>
       <div className="space-y-2">
         {forecast.map((f) => (
           <div key={f.day} className="flex items-center gap-3">
             <span className="text-[10px] font-mono text-muted-foreground w-16">{f.day}</span>
             <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
               <div
                 className="h-full rounded-full bg-gradient-to-r from-purple-400 to-purple-600 transition-all"
                 style={{ width: `${f.amount > 0 ? Math.max(8, (f.amount / maxForecast) * 100) : 0}%` }}
               />
             </div>
             <span className="text-[10px] font-mono font-semibold w-14 text-right">
               {f.amount > 0 ? `$${(f.amount / 1000).toFixed(1)}k` : "—"}
             </span>
           </div>
         ))}
       </div>
       <p className="text-[9px] text-muted-foreground mt-2 italic">
         Based on customer payment patterns & outstanding invoices
       </p>
     </div>

     {/* Payment Predictions */}
     <div className="rounded-2xl border border-border bg-background p-4">
       <div className="flex items-center gap-2 mb-3">
         <TrendingUp className="size-3.5 text-blue-500" />
         <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
           Payment predictions
         </p>
       </div>
       <div className="space-y-2">
         {predictions.slice(0, 4).map((pred) => (
           <button
             key={pred.invoiceId}
             onClick={() => {
               const inv = invoices.find((i) => i.id === pred.invoiceId);
               if (inv) onOpen(inv);
             }}
             className="w-full flex items-center justify-between p-2.5 rounded-xl bg-muted hover:bg-foreground/5 transition-colors text-left"
           >
             <div>
               <p className="text-[11px] font-semibold">{pred.customer}</p>
               <p className="text-[10px] font-mono text-muted-foreground">
                 Expected in ~{pred.predictedDays} days
               </p>
             </div>
             <div className="text-right">
               <p className="text-[11px] font-mono font-bold">{pred.currency} {pred.amount.toLocaleString()}</p>
               <div className="flex items-center gap-1 justify-end">
                 <div className="h-1.5 w-12 rounded-full bg-background overflow-hidden">
                   <div
                     className="h-full rounded-full bg-blue-500"
                     style={{ width: `${pred.confidence}%` }}
                   />
                 </div>
                 <span className="text-[9px] font-mono text-muted-foreground">{pred.confidence}%</span>
               </div>
             </div>
           </button>
         ))}
       </div>
     </div>

     {/* Auto-Chase Sequences */}
     <div className="rounded-2xl border border-border bg-background p-4">
       <div className="flex items-center gap-2 mb-3">
         <AlertTriangle className="size-3.5 text-amber-500" />
         <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
           Auto-chase status
         </p>
       </div>
       <div className="space-y-3">
         {pendingInvoices.slice(0, 3).map((inv) => {
           const chase = getChaseStatus(inv);
           return (
             <div key={inv.id} className="space-y-1.5">
               <div className="flex items-center justify-between">
                 <p className="text-[11px] font-semibold">{inv.customer}</p>
                 <span className="text-[9px] font-mono text-muted-foreground">{chase.daysOverdue}d old</span>
               </div>
               <div className="flex gap-1">
                 {CHASE_SEQUENCE.map((step, idx) => (
                   <div key={step.day} className="flex-1 flex flex-col items-center gap-0.5">
                     <div className={`h-1.5 w-full rounded-full ${
                       idx <= chase.currentStep
                         ? step.tone === "gentle" ? "bg-green-400"
                           : step.tone === "firm" ? "bg-amber-400"
                           : step.tone === "urgent" ? "bg-orange-500"
                           : "bg-red-500"
                         : "bg-muted"
                     }`} />
                     <span className="text-[7px] font-mono text-muted-foreground">{step.tone[0].toUpperCase()}</span>
                   </div>
                 ))}
               </div>
               {chase.nextAction && (
                 <p className="text-[9px] text-muted-foreground">
                   Next: <span className="font-semibold">{chase.nextAction.label}</span> on day {chase.nextAction.day}
                 </p>
               )}
             </div>
           );
         })}
       </div>
     </div>

     {/* Customer Health Scores */}
     <div className="rounded-2xl border border-border bg-background p-4">
       <div className="flex items-center gap-2 mb-3">
         <Users className="size-3.5 text-emerald-500" />
         <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
           Customer health scores
         </p>
       </div>
       <div className="space-y-2">
         {scores.map((customer) => (
           <div key={customer.name} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted">
             <span className={`size-7 rounded-full flex items-center justify-center text-xs font-bold ${
               customer.grade === "A" ? "bg-emerald-100 text-emerald-700" :
               customer.grade === "B" ? "bg-amber-100 text-amber-700" :
               "bg-red-100 text-red-700"
             }`}>
               {customer.grade}
             </span>
             <div className="flex-1 min-w-0">
               <p className="text-[11px] font-semibold truncate">{customer.name}</p>
               <p className="text-[9px] font-mono text-muted-foreground">
                 {customer.avgDaysToPay}d avg · {customer.totalInvoices} invoices · {Math.round(customer.onTimeRate * 100)}% on-time
               </p>
             </div>
             <span className="text-[10px] font-mono font-bold">${(customer.totalRevenue / 1000).toFixed(1)}k</span>
           </div>
         ))}
       </div>
     </div>
    </div>
  );
}

function InvoiceCreator({
  onCreate,
  initialInvoice,
  mode = "create",
  onCancel,
}: {
  onCreate: (i: Invoice) => void;
  initialInvoice?: Invoice;
  mode?: "create" | "edit";
  onCancel?: () => void;
}) {
  const [customer, setCustomer] = useState(initialInvoice?.customer ?? "");
  const [amount, setAmount] = useState(initialInvoice ? String(initialInvoice.amount) : "");
  const [currency, setCurrency] = useState(initialInvoice?.currency ?? "USD");
  const [note, setNote] = useState(initialInvoice?.note ?? "");
  const [isRecurring, setIsRecurring] = useState(Boolean(initialInvoice?.recurring));
  const [frequency, setFrequency] = useState(initialInvoice?.recurring?.frequency ?? "Monthly");
  const [hasInstallments, setHasInstallments] = useState(Boolean(initialInvoice?.installmentPlan));
  const [installmentCount, setInstallmentCount] = useState(initialInvoice?.installmentPlan?.count ?? 3);
  const [installmentFreq, setInstallmentFreq] = useState<"Weekly" | "Bi-weekly" | "Monthly">(initialInvoice?.installmentPlan?.frequency ?? "Monthly");
  const [lockFx, setLockFx] = useState(Boolean(initialInvoice?.fxLock));
  const [lockHours, setLockHours] = useState(48);
  const [lockTo, setLockTo] = useState("USD");
  const [deliveryChannel, setDeliveryChannel] = useState<Invoice["deliveryChannel"]>(initialInvoice?.deliveryChannel ?? "link");
  const [customerPhone, setCustomerPhone] = useState(initialInvoice?.customerPhone ?? "");

  const valid = customer.trim().length > 0 && Number(amount) > 0;
  const recurring = isRecurring
    ? {
        frequency,
        nextDate:
          initialInvoice?.recurring?.frequency === frequency
            ? initialInvoice.recurring.nextDate
            : nextRecurringDate(frequency),
      }
    : undefined;

  return (
    <div className="px-5 pt-3 space-y-4">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {mode === "edit" ? "Edit invoice" : "New invoice"}
        </p>
        <h1 className="text-lg font-bold">{mode === "edit" ? "Update payment request" : "Request a payment"}</h1>
      </div>

      <div className="space-y-3">
        <Field label="Customer">
          <input
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Acme Ltd."
            className="w-full bg-transparent text-sm font-medium outline-none"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Amount">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                inputMode="decimal"
                className="w-full bg-transparent text-2xl font-bold font-mono outline-none"
              />
            </Field>
          </div>
          <Field label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-transparent text-sm font-bold font-mono outline-none"
            >
              {["USD", "EUR", "GBP", "NGN", "KES"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Design retainer - Oct"
            className="w-full bg-transparent text-sm outline-none"
          />
        </Field>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Recurring</p>
              <p className="text-xs font-medium">Repeat this invoice automatically</p>
            </div>
            <button
              type="button"
              onClick={() => setIsRecurring((value) => !value)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                isRecurring ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-background transition-all ${
                  isRecurring ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
          {isRecurring && (
            <div className="grid grid-cols-3 gap-2">
              {(["Weekly", "Bi-weekly", "Monthly"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFrequency(option)}
                  className={`rounded-xl border px-2 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                    frequency === option
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Installments</p>
              <p className="text-xs font-medium">Split into multiple payments</p>
            </div>
            <button
              type="button"
              onClick={() => setHasInstallments((v) => !v)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                hasInstallments ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-background transition-all ${
                  hasInstallments ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
          {hasInstallments && (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                {[2, 3, 4, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setInstallmentCount(n)}
                    className={`rounded-xl border px-2 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                      installmentCount === n
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {n}×
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["Weekly", "Bi-weekly", "Monthly"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setInstallmentFreq(option)}
                    className={`rounded-xl border px-2 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                      installmentFreq === option
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {Number(amount) > 0 && (
                <p className="text-[10px] text-muted-foreground text-center font-mono">
                  {installmentCount} payments of {currency} {Math.round((Number(amount) / installmentCount) * 100 / 100).toLocaleString()} each
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">FX Rate Lock</p>
              <p className="text-xs font-medium">Guarantee rate for customer</p>
            </div>
            <button
              type="button"
              onClick={() => setLockFx((v) => !v)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                lockFx ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-background transition-all ${
                  lockFx ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
          {lockFx && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border px-2 py-1.5">
                  <p className="text-[8px] font-mono uppercase text-muted-foreground">Settle to</p>
                  <select
                    value={lockTo}
                    onChange={(e) => setLockTo(e.target.value)}
                    className="w-full bg-transparent text-xs font-bold font-mono outline-none"
                  >
                    {["USD", "EUR", "GBP"].filter((c) => c !== currency).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-lg border border-border px-2 py-1.5">
                  <p className="text-[8px] font-mono uppercase text-muted-foreground">Lock duration</p>
                  <select
                    value={lockHours}
                    onChange={(e) => setLockHours(Number(e.target.value))}
                    className="w-full bg-transparent text-xs font-bold font-mono outline-none"
                  >
                    <option value={24}>24 hours</option>
                    <option value={48}>48 hours</option>
                    <option value={72}>72 hours</option>
                  </select>
                </div>
              </div>
              {Number(amount) > 0 && currency !== lockTo && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 flex items-center gap-2">
                  <Lock className="size-3.5 text-emerald-600" />
                  <p className="text-[10px] font-mono text-emerald-700">
                    Locked: 1 {currency} = {(FX_RATES[currency]?.[lockTo] ?? 1).toFixed(4)} {lockTo} · receives {lockTo} {((Number(amount)) * (FX_RATES[currency]?.[lockTo] ?? 1)).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Delivery channel</p>
            <p className="text-xs font-medium">How to send the invoice</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {([
              { id: "link" as const, icon: "🔗", label: "Link" },
              { id: "whatsapp" as const, icon: "💬", label: "WhatsApp" },
              { id: "sms" as const, icon: "📱", label: "SMS" },
              { id: "email" as const, icon: "✉️", label: "Email" },
            ]).map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setDeliveryChannel(ch.id)}
                className={`rounded-xl border px-1 py-2.5 text-center transition-colors ${
                  deliveryChannel === ch.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground"
                }`}
              >
                <span className="text-sm block">{ch.icon}</span>
                <span className="text-[9px] font-mono uppercase tracking-widest">{ch.label}</span>
              </button>
            ))}
          </div>
          {(deliveryChannel === "whatsapp" || deliveryChannel === "sms") && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-[8px] font-mono uppercase text-muted-foreground">Phone number</p>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+254 7XX XXX XXX"
                className="w-full bg-transparent text-sm font-mono outline-none mt-0.5"
              />
            </div>
          )}
        </div>

        <div className="rounded-xl bg-muted p-3 flex justify-between text-[11px]">
          <span className="text-muted-foreground">FX routing</span>
          <span className="font-mono font-semibold">{lockFx ? `Locked · ${lockHours}h` : "Best rate · Wise"}</span>
        </div>
        <div className="rounded-xl bg-muted p-3 flex justify-between text-[11px]">
          <span className="text-muted-foreground">Settles to</span>
          <span className="font-mono font-semibold">{lockFx ? `${lockTo} wallet` : "USD wallet"}</span>
        </div>
      </div>

      <div className={`grid gap-2 ${mode === "edit" ? "grid-cols-2" : "grid-cols-1"}`}>
        {mode === "edit" && onCancel && (
          <button
            onClick={onCancel}
            className="w-full border border-border py-3.5 rounded-xl text-sm font-semibold"
          >
            Cancel
          </button>
        )}
        <button
          disabled={!valid}
          onClick={() =>
            onCreate({
              id: initialInvoice?.id ?? `INV-${Math.floor(10000 + Math.random() * 89999)}`,
              customer: customer.trim(),
              amount: Number(amount),
              currency,
              note: note.trim() || undefined,
              status: initialInvoice?.status ?? "Pending",
              date: initialInvoice?.date ?? "Today",
              paidAt: initialInvoice?.paidAt,
              paidVia: initialInvoice?.paidVia,
              recurring,
              installmentPlan: hasInstallments
                ? {
                    count: installmentCount,
                    frequency: installmentFreq,
                    installments: generateInstallments(Number(amount), installmentCount, installmentFreq),
                  }
                : undefined,
              fxLock: lockFx && currency !== lockTo ? lockFxRate(currency, lockTo, lockHours) : undefined,
              deliveryChannel,
              customerPhone: customerPhone.trim() || undefined,
              lastReminder: initialInvoice?.lastReminder,
              timeline:
                initialInvoice?.timeline ??
                [
                  { label: "Created", at: new Date().toISOString() },
                  ...(lockFx ? [{ label: `FX rate locked · ${lockHours}h`, at: shiftTimestamp(new Date(), 1) }] : []),
                  { label: deliveryChannel === "whatsapp" ? "Sent via WhatsApp" : deliveryChannel === "sms" ? "Sent via SMS" : "QR shared", at: shiftTimestamp(new Date(), 12) },
                ],
            })
          }
          className="w-full bg-foreground text-background py-3.5 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {mode === "edit" ? <Pencil className="size-4" /> : <QrCode className="size-4" />}
          {mode === "edit" ? "Save changes" : "Generate QR invoice"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function ScanView({
  invoices,
  onDetected,
}: {
  invoices: Invoice[];
  onDetected: (inv: Invoice) => void;
}) {
  const [raw, setRaw] = useState("");

  function tryDecode(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // 1. JSON FX Engine payload
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.type === "fx-engine/invoice" && obj.id) {
        const known = invoices.find((i) => i.id === obj.id);
        if (known) return onDetected(known);
        return onDetected({
          id: obj.id,
          customer: obj.customer ?? "Unknown",
          amount: Number(obj.amount) || 0,
          currency: obj.currency ?? "USD",
          status: "Pending",
          date: "Scanned",
          note: obj.note,
        });
      }
    } catch {
      /* not json */
    }
    // 2. URL with ?pay=INV-xxxx
    try {
      const url = new URL(trimmed);
      const id = url.searchParams.get("pay");
      if (id) {
        const known = invoices.find((i) => i.id === id);
        if (known) return onDetected(known);
      }
    } catch {
      /* not url */
    }
    // 3. Plain invoice id
    const known = invoices.find((i) => i.id.toLowerCase() === trimmed.toLowerCase());
    if (known) return onDetected(known);

    toast.error("Unrecognized QR payload", { description: "Try an FX Engine invoice." });
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      setRaw(text);
      tryDecode(text);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  const oldestUnpaid = invoices.find((i) => i.status !== "Paid");

  return (
    <div className="px-5 pt-3 space-y-4">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Scanner</p>
        <h1 className="text-lg font-bold">Scan a QR to pay</h1>
      </div>

      <div className="relative aspect-square rounded-2xl bg-foreground overflow-hidden">
        <div className="absolute inset-8 border-2 border-background/40 rounded-2xl" />
        {[
          "top-8 left-8",
          "top-8 right-8 rotate-90",
          "bottom-8 left-8 -rotate-90",
          "bottom-8 right-8 rotate-180",
        ].map((p) => (
          <div key={p} className={`absolute ${p} size-6 border-t-2 border-l-2 border-accent rounded-tl-md`} />
        ))}
        <div className="absolute left-8 right-8 top-1/2 h-0.5 bg-accent shadow-[0_0_12px_var(--accent)] animate-pulse" />
        <p className="absolute bottom-4 inset-x-0 text-center text-[10px] font-mono text-background/70">
          Aligning cameraâ¦
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
          QR payload / invoice ID
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='Paste JSON, URL or INV-xxxxx'
          rows={2}
          className="w-full bg-transparent text-[11px] font-mono outline-none resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={handlePaste}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border border-border text-[11px] font-medium hover:bg-muted"
          >
            <ClipboardPaste className="size-3.5" /> Paste
          </button>
          <button
            onClick={() => tryDecode(raw)}
            className="flex-1 py-2 rounded-md bg-foreground text-background text-[11px] font-semibold"
          >
            Decode
          </button>
        </div>
        {oldestUnpaid && (
          <button
            onClick={() => onDetected(oldestUnpaid)}
            className="w-full text-[10px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Demo: simulate scanning {oldestUnpaid.id}
          </button>
        )}
      </div>

      <div className="rounded-xl bg-muted p-4 space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Supported</p>
        <div className="flex flex-wrap gap-1.5">
          {["EMVCo QR", "PIX BR", "UPI IN", "PromptPay TH", "FX Engine"].map((s) => (
            <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-card border border-border">
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function InvoiceListView({
  invoices,
  onOpen,
  onMarkPaid,
  onSendReminder,
}: {
  invoices: Invoice[];
  onOpen: (i: Invoice) => void;
  onMarkPaid: (id: string) => void;
  onSendReminder: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"All" | Invoice["status"]>("All");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const filtered = filter === "All" ? invoices : invoices.filter((i) => i.status === filter);
  const selectedInvoices = invoices.filter((invoice) => selectedIds.includes(invoice.id));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function exportSelected() {
    if (selectedInvoices.length === 0) return;
    const blob = new Blob([JSON.stringify(selectedInvoices, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `merchant-invoices-${selectedInvoices.length}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedInvoices.length} invoices`);
  }

  return (
    <div className="px-5 pt-3 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Ledger</p>
          <h1 className="text-lg font-bold">All invoices</h1>
        </div>
        <button
          onClick={() => {
            setSelectMode((value) => !value);
            setSelectedIds([]);
          }}
          className={`rounded-full border px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
            selectMode ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"
          }`}
        >
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {(["All", "Pending", "Partial", "Overdue", "Paid"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-[10px] font-semibold border ${
              filter === f
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      {selectMode && (
        <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Selected invoices</span>
            <span className="font-mono font-semibold">{selectedIds.length}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                const actionable = selectedInvoices.filter((invoice) => invoice.status !== "Paid");
                actionable.forEach((invoice) => onMarkPaid(invoice.id));
                if (actionable.length) toast.success(`Marked ${actionable.length} invoices as paid`);
                setSelectedIds([]);
              }}
              className="flex flex-col items-center gap-1 rounded-xl bg-muted px-2 py-3 text-[10px] font-medium"
            >
              <Check className="size-4" />
              Mark all paid
            </button>
            <button
              onClick={() => {
                const actionable = selectedInvoices.filter((invoice) => invoice.status !== "Paid");
                actionable.forEach((invoice) => onSendReminder(invoice.id));
                if (actionable.length) toast.success(`Sent ${actionable.length} reminders`);
                setSelectedIds([]);
              }}
              className="flex flex-col items-center gap-1 rounded-xl bg-muted px-2 py-3 text-[10px] font-medium"
            >
              <Send className="size-4" />
              Send reminders
            </button>
            <button
              onClick={exportSelected}
              className="flex flex-col items-center gap-1 rounded-xl bg-muted px-2 py-3 text-[10px] font-medium"
            >
              <Download className="size-4" />
              Export selected
            </button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-[11px] text-muted-foreground py-8">No invoices.</p>
        )}
        {filtered.map((i) => (
          <InvoiceRow
            key={i.id}
            invoice={i}
            selectable={selectMode}
            selected={selectedIds.includes(i.id)}
            onClick={() => (selectMode ? toggleSelected(i.id) : onOpen(i))}
          />
        ))}
      </div>
    </div>
  );
}

function InvoiceDetailSheet({
  invoice,
  onClose,
  onMarkPaid,
  onEdit,
  onSendReminder,
  onRecordPayment,
}: {
  invoice: Invoice;
  onClose: () => void;
  onMarkPaid: () => void;
  onEdit: () => void;
  onSendReminder: () => void;
  onRecordPayment: (amount: number, via?: string) => void;
}) {
  const link = payLink(invoice);
  const timeline = timelineFor(invoice);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialVia, setPartialVia] = useState("FX Engine");
  const paid = totalPaid(invoice);
  const remaining = amountRemaining(invoice);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Payment link copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function share() {
    const shareData = {
      title: `Invoice ${invoice.id}`,
      text: `${invoice.customer} · ${invoice.currency} ${invoice.amount}`,
      url: link,
    };
    if (typeof navigator !== "undefined" && (navigator as Navigator).share) {
      try {
        await (navigator as Navigator).share(shareData);
      } catch {
        /* user cancelled */
      }
    } else {
      copyLink();
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end rounded-b-[2.4rem] overflow-hidden">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <div className="relative w-full bg-card rounded-t-3xl p-5 space-y-4 animate-slide-up max-h-[92%] overflow-y-auto">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              {invoice.id}
            </p>
            <h2 className="text-base font-bold">{invoice.customer}</h2>
          </div>
          <button onClick={onClose} className="size-8 rounded-full bg-muted flex items-center justify-center">
            <X className="size-4" />
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-background p-5 flex flex-col items-center gap-3">
          <QRCodeSVG
            value={payloadFor(invoice)}
            size={180}
            level="M"
            bgColor="transparent"
            fgColor="oklch(0.22 0 0)"
          />
          <p className="text-[10px] font-mono text-muted-foreground text-center break-all px-4">
            {link}
          </p>
        </div>

        <div className="rounded-xl bg-muted p-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {paid > 0 ? "Remaining balance" : "Amount due"}
          </p>
          <p className="text-3xl font-bold font-mono mt-1">
            {invoice.currency} {paid > 0 ? remaining.toLocaleString() : invoice.amount.toLocaleString()}.00
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Status · <span className="font-semibold">{invoice.status}</span>
          </p>
          {paid > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground px-1">
                <span>Paid: {invoice.currency} {paid.toLocaleString()}</span>
                <span>{Math.round((paid / invoice.amount) * 100)}%</span>
              </div>
              <div className="h-2 rounded-full bg-background overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(100, (paid / invoice.amount) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className={`grid gap-2 ${invoice.status === "Pending" || invoice.status === "Overdue" || invoice.status === "Partial" ? "grid-cols-5" : "grid-cols-3"}`}>
          <SheetBtn icon={Copy} label="Copy link" onClick={copyLink} />
          <SheetBtn icon={Share2} label="Share" onClick={share} />
          {(invoice.status === "Pending" || invoice.status === "Overdue" || invoice.status === "Partial") && (
            <SheetBtn icon={Pencil} label="Edit" onClick={onEdit} />
          )}
          {(invoice.status === "Pending" || invoice.status === "Overdue" || invoice.status === "Partial") && (
            <SheetBtn icon={CircleDollarSign} label="Record $" onClick={() => setShowRecordPayment(true)} />
          )}
          <SheetBtn
            icon={Check}
            label={invoice.status === "Paid" ? "Paid ✓" : "Mark paid"}
            disabled={invoice.status === "Paid"}
            onClick={onMarkPaid}
          />
        </div>

        {showRecordPayment && (
          <div className="rounded-2xl border border-accent bg-background p-4 space-y-3 animate-slide-up">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Record partial payment
            </p>
            <input
              type="number"
              placeholder={`Amount (max ${remaining.toLocaleString()})`}
              value={partialAmount}
              onChange={(e) => setPartialAmount(e.target.value)}
              max={remaining}
              className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <select
              value={partialVia}
              onChange={(e) => setPartialVia(e.target.value)}
              className="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option>FX Engine</option>
              <option>Bank Transfer</option>
              <option>M-Pesa</option>
              <option>Cash</option>
              <option>Wise</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRecordPayment(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-xs font-mono uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                disabled={!partialAmount || Number(partialAmount) <= 0 || Number(partialAmount) > remaining}
                onClick={() => {
                  onRecordPayment(Number(partialAmount), partialVia);
                  setPartialAmount("");
                  setShowRecordPayment(false);
                }}
                className="flex-1 rounded-xl bg-foreground text-background py-2.5 text-xs font-mono uppercase tracking-wider disabled:opacity-40"
              >
                Record payment
              </button>
            </div>
          </div>
        )}

        {(invoice.status === "Pending" || invoice.status === "Overdue") && (
          <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Payment reminder
                </p>
                {invoice.lastReminder ? (
                  <p className="text-[11px] text-muted-foreground">Reminded {timeAgo(invoice.lastReminder)}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">No reminder sent yet</p>
                )}
              </div>
              <button
                onClick={onSendReminder}
                className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-background"
              >
                <Send className="size-3.5" />
                Send reminder
              </button>
            </div>
          </div>
        )}

        {invoice.status !== "Paid" && (
          <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Send invoice via
            </p>
            <div className="grid grid-cols-3 gap-2">
              <a
                href={whatsAppLink(invoice, link)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 py-3 rounded-xl bg-green-50 border border-green-200 hover:bg-green-100 transition-colors"
              >
                <MessageCircle className="size-4 text-green-600" />
                <span className="text-[9px] font-mono uppercase tracking-widest text-green-700">WhatsApp</span>
              </a>
              <a
                href={smsLink(invoice, link)}
                className="flex flex-col items-center gap-1 py-3 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors"
              >
                <Send className="size-4 text-blue-600" />
                <span className="text-[9px] font-mono uppercase tracking-widest text-blue-700">SMS</span>
              </a>
              <button
                onClick={share}
                className="flex flex-col items-center gap-1 py-3 rounded-xl bg-muted border border-border hover:bg-foreground hover:text-background transition-colors"
              >
                <Share2 className="size-4" />
                <span className="text-[9px] font-mono uppercase tracking-widest">Share</span>
              </button>
            </div>
          </div>
        )}

        {invoice.fxLock && (
          <div className={`rounded-2xl border p-4 space-y-2 ${
            fxLockTimeRemaining(invoice.fxLock) === "Expired"
              ? "border-red-200 bg-red-50"
              : "border-emerald-200 bg-emerald-50"
          }`}>
            <div className="flex items-center gap-2">
              <Lock className={`size-4 ${fxLockTimeRemaining(invoice.fxLock) === "Expired" ? "text-red-600" : "text-emerald-600"}`} />
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">
                FX Rate Locked
              </p>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Rate</span>
              <span className="font-mono font-bold">1 {invoice.fxLock.from} = {invoice.fxLock.rate.toFixed(4)} {invoice.fxLock.to}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">You receive</span>
              <span className="font-mono font-bold">{invoice.fxLock.to} {(invoice.amount * invoice.fxLock.rate).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Expires in</span>
              <span className={`font-mono font-bold ${fxLockTimeRemaining(invoice.fxLock) === "Expired" ? "text-red-600" : "text-emerald-600"}`}>
                {fxLockTimeRemaining(invoice.fxLock)}
              </span>
            </div>
          </div>
        )}

        {(invoice.status === "Pending" || invoice.status === "Overdue" || invoice.status === "Partial") && (
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3 flex items-center gap-3">
            <Brain className="size-5 text-purple-500 shrink-0" />
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-purple-600">AI Prediction</p>
              <p className="text-[11px] font-semibold text-purple-800">
                {invoice.customer} typically pays in ~{Math.max(2, Math.round(Math.random() * 8 + 4))} days
              </p>
            </div>
          </div>
        )}

        <div className="space-y-1.5 pt-2">
          {[
            ["Issue date", invoice.date],
            ["Settles to", "USD wallet"],
            ["FX route", invoice.paidVia ? `Settled · ${invoice.paidVia}` : "Best rate · Wise"],
            ["Fee", "0.35 %"],
            ...(invoice.recurring
              ? [["Recurring", `${invoice.recurring.frequency} · next ${formatTimelineDate(invoice.recurring.nextDate)}`]]
              : []),
            ...(invoice.installmentPlan
              ? [["Installments", `${invoice.installmentPlan.count}× ${invoice.installmentPlan.frequency}`]]
              : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-[11px] py-1.5 border-b border-border last:border-none">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono font-semibold">{v}</span>
            </div>
          ))}
        </div>

        {invoice.installmentPlan && (
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
              Installment schedule
            </p>
            <div className="space-y-2">
              {invoice.installmentPlan.installments.map((inst) => (
                <div key={inst.number} className="flex items-center justify-between py-1.5 border-b border-border last:border-none">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${
                      inst.status === "Paid" ? "bg-green-500" :
                      inst.status === "Due" ? "bg-amber-500" :
                      inst.status === "Overdue" ? "bg-red-500" :
                      "bg-muted-foreground/30"
                    }`} />
                    <span className="text-[11px] font-mono">#{inst.number}</span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold">
                    {invoice.currency} {inst.amount.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {inst.status === "Paid" ? "Paid ✓" : formatTimelineDate(inst.dueDate)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(invoice.payments ?? []).length > 0 && (
          <div className="rounded-2xl border border-border bg-background p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
              Payment history
            </p>
            <div className="space-y-2">
              {(invoice.payments ?? []).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-none">
                  <div>
                    <span className="text-[11px] font-mono font-semibold">
                      {invoice.currency} {p.amount.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-2">via {p.paidVia}</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">{formatTimelineDate(p.paidAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-background p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Payment timeline
          </p>
          <div className="space-y-0">
            {timeline.map((event, index) => (
              <div key={`${event.label}-${event.at}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="mt-1 size-2.5 rounded-full bg-foreground" />
                  {index < timeline.length - 1 && <span className="mt-1 w-px flex-1 min-h-8 bg-border" />}
                </div>
                <div className="pb-4">
                  <p className="text-xs font-semibold">{event.label}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{formatTimelineDate(event.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Plus;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 py-3 rounded-xl bg-muted hover:bg-foreground hover:text-background transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-muted disabled:hover:text-foreground"
    >
      <Icon className="size-4" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

const PROVIDERS = [
  { id: "Wise", rate: 1.0842, fee: 0.0035 },
  { id: "Currencycloud", rate: 1.0838, fee: 0.004 },
  { id: "LMAX", rate: 1.0845, fee: 0.005 },
  { id: "Verto", rate: 1.0831, fee: 0.003 },
];

function PaySheet({
  invoice,
  onClose,
  onConfirm,
}: {
  invoice: Invoice;
  onClose: () => void;
  onConfirm: (provider: string) => void;
}) {
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [processing, setProcessing] = useState(false);

  const selected = PROVIDERS.find((p) => p.id === provider)!;
  const fee = invoice.amount * selected.fee;
  const total = invoice.amount + fee;

  function confirm() {
    setProcessing(true);
    setTimeout(() => {
      onConfirm(provider);
      setProcessing(false);
    }, 900);
  }

  const alreadyPaid = invoice.status === "Paid";

  return (
    <div className="absolute inset-0 z-50 flex items-end rounded-b-[2.4rem] overflow-hidden">
      <div className="absolute inset-0 bg-foreground/50" onClick={onClose} />
      <div className="relative w-full bg-card rounded-t-3xl p-5 space-y-4 animate-slide-up">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Confirm payment
            </p>
            <h2 className="text-base font-bold">{invoice.customer}</h2>
            <p className="text-[10px] font-mono text-muted-foreground">{invoice.id}</p>
          </div>
          <button onClick={onClose} className="size-8 rounded-full bg-muted flex items-center justify-center">
            <X className="size-4" />
          </button>
        </div>

        <div className="rounded-xl bg-foreground text-background p-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">You pay</p>
          <p className="text-3xl font-bold font-mono mt-1">
            {invoice.currency} {total.toFixed(2)}
          </p>
          <p className="text-[10px] opacity-60 mt-1">
            incl. {invoice.currency} {fee.toFixed(2)} fee Â· rate {selected.rate}
          </p>
        </div>

        {alreadyPaid ? (
          <div className="rounded-xl bg-emerald-50 text-emerald-700 p-3 text-center text-[11px] font-semibold">
            This invoice is already settled.
          </div>
        ) : (
          <>
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                Route via
              </p>
              <div className="space-y-1.5">
                {PROVIDERS.map((p) => {
                  const active = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setProvider(p.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-colors ${
                        active ? "border-foreground bg-muted" : "border-border"
                      }`}
                    >
                      <div>
                        <p className="text-xs font-semibold">{p.id}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          rate {p.rate} Â· fee {(p.fee * 100).toFixed(2)}%
                        </p>
                      </div>
                      {active && <Check className="size-4" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                <Globe className="size-3 inline mr-1" />
                Local payment methods · {detectRegionFromCurrency(invoice.currency)}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {getPaymentMethodsForRegion(detectRegionFromCurrency(invoice.currency)).map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-left"
                  >
                    <span className="text-sm">{m.icon}</span>
                    <span className="text-[10px] font-medium truncate">{m.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={confirm}
              disabled={processing}
              className="w-full bg-accent text-accent-foreground py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {processing ? (
                <>
                  <span className="size-3 border-2 border-accent-foreground border-t-transparent rounded-full animate-spin" />
                  Settlingâ¦
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" /> Pay {invoice.currency} {total.toFixed(2)}
                </>
              )}
            </button>
            <p className="text-[10px] text-center text-muted-foreground">
              Secured by FX Engine Â· 3D-Secure where applicable
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── TABLE SERVICE VIEW ─────────────────────────────────────────────────────────

type TableOrder = {
  id: string;
  tableNumber: number;
  server: string;
  items: { id: string; name: string; price: number; qty: number; category: string }[];
  status: "open" | "requesting-bill" | "partially-paid" | "closed";
  openedAt: string;
  closedAt?: string;
  paidAmount: number;
  payments: { name: string; amount: number; tip: number; phone: string; time: string }[];
  quickCharge?: number;
};

type CatalogueItem = {
  id: string;
  name: string;
  price: number;
  category: string;
  dietary?: string[]; // "vegan" | "vegetarian" | "gluten-free" | "halal" | "contains-nuts" | "dairy-free"
  destination?: "kitchen" | "bar"; // where the order goes
};

type OrderTicket = {
  id: string;
  tableNumber: number;
  items: { name: string; qty: number; notes?: string }[];
  destination: "kitchen" | "bar";
  status: "new" | "preparing" | "ready" | "served";
  orderedAt: string;
  preparedAt?: string;
  servedAt?: string;
  server: string;
  customerName?: string;
};

type Reservation = {
  id: string;
  tableNumber: number;
  customerName: string;
  phone: string;
  date: string; // ISO date
  time: string; // "HH:MM"
  covers: number;
  status: "confirmed" | "seated" | "cancelled" | "no-show";
  notes?: string;
};

type LoyaltyCustomer = {
  phone: string;
  name: string;
  points: number;
  totalSpent: number;
  visits: number;
  tier: "Bronze" | "Silver" | "Gold" | "Platinum";
  lastVisit: string;
};

const DEFAULT_CATALOGUE: CatalogueItem[] = [
  { id: "m1", name: "Nyama Choma (500g)", price: 850, category: "Main", destination: "kitchen", dietary: ["halal"] },
  { id: "m2", name: "Pilau Rice", price: 350, category: "Main", destination: "kitchen", dietary: ["halal", "gluten-free"] },
  { id: "m3", name: "Fish Fry", price: 650, category: "Main", destination: "kitchen", dietary: ["gluten-free"] },
  { id: "m4", name: "Ugali", price: 100, category: "Side", destination: "kitchen", dietary: ["vegan", "gluten-free"] },
  { id: "m5", name: "Sukuma Wiki", price: 80, category: "Side", destination: "kitchen", dietary: ["vegan", "gluten-free"] },
  { id: "m6", name: "Chapati", price: 50, category: "Side", destination: "kitchen", dietary: ["vegetarian"] },
  { id: "m7", name: "Tusker Lager", price: 250, category: "Drinks", destination: "bar" },
  { id: "m8", name: "Coca Cola", price: 120, category: "Drinks", destination: "bar", dietary: ["vegan"] },
  { id: "m9", name: "Fresh Juice", price: 200, category: "Drinks", destination: "bar", dietary: ["vegan", "gluten-free"] },
  { id: "m10", name: "Mandazi (4pc)", price: 80, category: "Snack", destination: "kitchen", dietary: ["vegetarian"] },
];

const SERVERS = ["Grace M.", "Peter K.", "Alice N.", "David O."];

function TableServiceView() {
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>(() => {
    if (typeof window === "undefined") return DEFAULT_CATALOGUE;
    const saved = localStorage.getItem("fxengine.merchant.catalogue");
    return saved ? JSON.parse(saved) : DEFAULT_CATALOGUE;
  });

  const [tables, setTables] = useState<TableOrder[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("fxengine.merchant.tables");
    if (saved) return JSON.parse(saved);
    return [
      {
        id: "tbl-1",
        tableNumber: 1,
        server: "Grace M.",
        items: [
          { id: "m1", name: "Nyama Choma (500g)", price: 850, qty: 1, category: "Main" },
          { id: "m4", name: "Ugali", price: 100, qty: 2, category: "Side" },
          { id: "m7", name: "Tusker Lager", price: 250, qty: 2, category: "Drinks" },
        ],
        status: "open" as const,
        openedAt: new Date(Date.now() - 35 * 60000).toISOString(),
        paidAmount: 0,
        payments: [],
      },
      {
        id: "tbl-3",
        tableNumber: 3,
        server: "Peter K.",
        items: [
          { id: "m2", name: "Pilau Rice", price: 350, qty: 2, category: "Main" },
          { id: "m8", name: "Coca Cola", price: 120, qty: 3, category: "Drinks" },
          { id: "m10", name: "Mandazi (4pc)", price: 80, qty: 1, category: "Snack" },
        ],
        status: "requesting-bill" as const,
        openedAt: new Date(Date.now() - 50 * 60000).toISOString(),
        paidAmount: 0,
        payments: [],
      },
      {
        id: "tbl-7",
        tableNumber: 7,
        server: "Alice N.",
        items: [
          { id: "m3", name: "Fish Fry", price: 650, qty: 2, category: "Main" },
          { id: "m5", name: "Sukuma Wiki", price: 80, qty: 2, category: "Side" },
          { id: "m9", name: "Fresh Juice", price: 200, qty: 4, category: "Drinks" },
          { id: "m6", name: "Chapati", price: 50, qty: 6, category: "Side" },
        ],
        status: "partially-paid" as const,
        openedAt: new Date(Date.now() - 72 * 60000).toISOString(),
        paidAmount: 1200,
        payments: [
          { name: "John", amount: 1200, tip: 100, phone: "+254722***456", time: new Date(Date.now() - 10 * 60000).toISOString() },
        ],
      },
    ];
  });

  const [selectedTable, setSelectedTable] = useState<TableOrder | null>(null);
  const [view, setView] = useState<"overview" | "detail" | "add-items" | "qr" | "catalogue" | "quick-charge" | "tips-analytics" | "payment-history" | "ai-forecast" | "ai-staffing" | "ai-insights" | "ai-anomalies" | "orders-queue" | "reservations" | "loyalty">("overview");
  const [newTableNum, setNewTableNum] = useState("");
  const [newTableServer, setNewTableServer] = useState(SERVERS[0]);
  const [showNewTable, setShowNewTable] = useState(false);
  const [addingItems, setAddingItems] = useState<Map<string, number>>(new Map());
  // Catalogue form
  const [catName, setCatName] = useState("");
  const [catPrice, setCatPrice] = useState("");
  const [catCategory, setCatCategory] = useState("Main");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  // Quick charge
  const [quickAmount, setQuickAmount] = useState("");

  // Orders queue (kitchen/bar)
  const [orders, setOrders] = useState<OrderTicket[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("fxengine.merchant.orders");
    return saved ? JSON.parse(saved) : [];
  });
  const [ordersFilter, setOrdersFilter] = useState<"all" | "kitchen" | "bar">("all");

  // Reservations
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("fxengine.merchant.reservations");
    return saved ? JSON.parse(saved) : [];
  });

  // Loyalty
  const [loyaltyCustomers, setLoyaltyCustomers] = useState<LoyaltyCustomer[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("fxengine.merchant.loyalty");
    return saved ? JSON.parse(saved) : [];
  });

  // Catalogue form extras (dietary/destination)
  const [catDietary, setCatDietary] = useState<string[]>([]);
  const [catDest, setCatDest] = useState<"kitchen" | "bar">("kitchen");

  // Reservation form
  const [resName, setResName] = useState("");
  const [resPhone, setResPhone] = useState("");
  const [resDate, setResDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [resTime, setResTime] = useState("19:00");
  const [resCovers, setResCovers] = useState("2");
  const [resTable, setResTable] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fxengine.merchant.tables", JSON.stringify(tables));
    }
  }, [tables]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fxengine.merchant.catalogue", JSON.stringify(catalogue));
    }
  }, [catalogue]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fxengine.merchant.orders", JSON.stringify(orders));
    }
  }, [orders]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fxengine.merchant.reservations", JSON.stringify(reservations));
    }
  }, [reservations]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fxengine.merchant.loyalty", JSON.stringify(loyaltyCustomers));
    }
  }, [loyaltyCustomers]);

  // Loyalty helper: award points on payment
  function awardLoyaltyPoints(phone: string, name: string, amount: number) {
    const points = Math.floor(amount / 10); // 1 point per KES 10
    setLoyaltyCustomers((prev) => {
      const existing = prev.find((c) => c.phone === phone);
      if (existing) {
        return prev.map((c) =>
          c.phone === phone
            ? {
                ...c,
                points: c.points + points,
                totalSpent: c.totalSpent + amount,
                visits: c.visits + 1,
                lastVisit: new Date().toISOString(),
                tier: getTier(c.totalSpent + amount),
              }
            : c,
        );
      }
      return [...prev, { phone, name: name || "Guest", points, totalSpent: amount, visits: 1, tier: "Bronze" as const, lastVisit: new Date().toISOString() }];
    });
  }

  function getTier(totalSpent: number): "Bronze" | "Silver" | "Gold" | "Platinum" {
    if (totalSpent >= 50000) return "Platinum";
    if (totalSpent >= 20000) return "Gold";
    if (totalSpent >= 5000) return "Silver";
    return "Bronze";
  }

  // Order ticket helper
  function submitOrder(tableNum: number, items: { name: string; qty: number; notes?: string; destination: "kitchen" | "bar" }[], server: string, customerName?: string) {
    const kitchenItems = items.filter((i) => i.destination === "kitchen");
    const barItems = items.filter((i) => i.destination === "bar");
    const newOrders: OrderTicket[] = [];
    if (kitchenItems.length > 0) {
      newOrders.push({
        id: `ord-k-${Date.now()}`,
        tableNumber: tableNum,
        items: kitchenItems.map(({ name, qty, notes }) => ({ name, qty, notes })),
        destination: "kitchen",
        status: "new",
        orderedAt: new Date().toISOString(),
        server,
        customerName,
      });
    }
    if (barItems.length > 0) {
      newOrders.push({
        id: `ord-b-${Date.now()}`,
        tableNumber: tableNum,
        items: barItems.map(({ name, qty, notes }) => ({ name, qty, notes })),
        destination: "bar",
        status: "new",
        orderedAt: new Date().toISOString(),
        server,
        customerName,
      });
    }
    setOrders((prev) => [...newOrders, ...prev]);
    newOrders.forEach((o) => {
      notifyStaff(tableNum, 0, `New ${o.destination} order: ${o.items.length} items`);
    });
  }

  function updateOrderStatus(orderId: string, status: OrderTicket["status"]) {
    setOrders((prev) => prev.map((o) => {
      if (o.id !== orderId) return o;
      const updates: Partial<OrderTicket> = { status };
      if (status === "ready") updates.preparedAt = new Date().toISOString();
      if (status === "served") updates.servedAt = new Date().toISOString();
      return { ...o, ...updates };
    }));
    const order = orders.find((o) => o.id === orderId);
    if (order && status === "ready") {
      toast.success(`🔔 Table ${order.tableNumber}: ${order.destination} order ready!`);
    }
  }

  function getTotal(t: TableOrder) {
    if (t.quickCharge) return t.quickCharge;
    return t.items.reduce((s, i) => s + i.price * i.qty, 0);
  }

  function getRemainingBalance(t: TableOrder) {
    return getTotal(t) - t.paidAmount;
  }

  // Staff notification with sound
  function notifyStaff(tableNum: number, amount: number, payer: string) {
    // Play notification sound
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* audio not available */ }

    toast.success(`💰 Table ${tableNum} — KES ${amount.toLocaleString()} received`, {
      description: `From ${payer} via M-Pesa`,
      duration: 5000,
    });
  }

  // Walkout risk detection
  const walkoutRiskTables = useMemo(
    () => tables.filter((t) => {
      if (t.status === "closed") return false;
      const elapsed = (Date.now() - new Date(t.openedAt).getTime()) / 60000;
      return elapsed > 120 && t.paidAmount === 0;
    }),
    [tables],
  );

  // Auto-close tables that are fully paid
  useEffect(() => {
    const toClose = tables.filter((t) => {
      if (t.status === "closed") return false;
      const total = getTotal(t);
      return total > 0 && t.paidAmount >= total;
    });
    if (toClose.length > 0) {
      setTables((prev) =>
        prev.map((t) => {
          const total = getTotal(t);
          if (t.status !== "closed" && total > 0 && t.paidAmount >= total) {
            return { ...t, status: "closed" as const, closedAt: new Date().toISOString() };
          }
          return t;
        }),
      );
      toClose.forEach((t) => {
        toast.success(`✅ Table ${t.tableNumber} auto-closed (fully paid)`);
      });
    }
  }, [tables]);

  function createTable() {
    if (!newTableNum) return;
    const t: TableOrder = {
      id: `tbl-${Date.now().toString(36)}`,
      tableNumber: Number(newTableNum),
      server: newTableServer,
      items: [],
      status: "open",
      openedAt: new Date().toISOString(),
      paidAmount: 0,
      payments: [],
    };
    setTables((prev) => [...prev, t]);
    setNewTableNum("");
    setShowNewTable(false);
    setSelectedTable(t);
    setView("add-items");
    toast.success(`Table ${t.tableNumber} opened`);
  }

  function createQuickChargeTable() {
    if (!newTableNum || !quickAmount || Number(quickAmount) <= 0) return;
    const t: TableOrder = {
      id: `tbl-${Date.now().toString(36)}`,
      tableNumber: Number(newTableNum),
      server: newTableServer,
      items: [],
      status: "open",
      openedAt: new Date().toISOString(),
      paidAmount: 0,
      payments: [],
      quickCharge: Number(quickAmount),
    };
    setTables((prev) => [...prev, t]);
    setNewTableNum("");
    setQuickAmount("");
    setView("overview");
    toast.success(`Table ${t.tableNumber} opened — KES ${Number(quickAmount).toLocaleString()}`);
  }

  function addItemsToTable() {
    if (!selectedTable) return;
    const newItems = [...selectedTable.items];
    addingItems.forEach((qty, menuId) => {
      if (qty <= 0) return;
      const menuItem = catalogue.find((m) => m.id === menuId);
      if (!menuItem) return;
      const existing = newItems.find((i) => i.id === menuId);
      if (existing) {
        existing.qty += qty;
      } else {
        newItems.push({ ...menuItem, qty });
      }
    });
    setTables((prev) =>
      prev.map((t) => (t.id === selectedTable.id ? { ...t, items: newItems } : t)),
    );
    setSelectedTable({ ...selectedTable, items: newItems });
    setAddingItems(new Map());
    setView("detail");
    toast.success("Items added to table");
  }

  function closeTable(tableId: string) {
    setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, status: "closed" as const, closedAt: new Date().toISOString() } : t)));
    setSelectedTable(null);
    setView("overview");
    toast.success("Table closed");
  }

  function saveCatalogueItem() {
    if (!catName || !catPrice || Number(catPrice) <= 0) return;
    if (editingCatId) {
      setCatalogue((prev) =>
        prev.map((c) => (c.id === editingCatId ? { ...c, name: catName, price: Number(catPrice), category: catCategory } : c)),
      );
      setEditingCatId(null);
    } else {
      setCatalogue((prev) => [
        ...prev,
        { id: `cat-${Date.now().toString(36)}`, name: catName, price: Number(catPrice), category: catCategory },
      ]);
    }
    setCatName("");
    setCatPrice("");
    setCatCategory("Main");
    toast.success(editingCatId ? "Item updated" : "Item added to catalogue");
  }

  function deleteCatalogueItem(id: string) {
    setCatalogue((prev) => prev.filter((c) => c.id !== id));
    toast.success("Item removed");
  }

  function generateTableQR(t: TableOrder) {
    const payload = btoa(
      JSON.stringify({
        tableNumber: t.tableNumber,
        merchant: MERCHANT_NAME,
        till: TILL_NUMBER,
        server: t.server,
        items: t.items,
        openedAt: t.openedAt,
        ...(t.quickCharge ? { quickCharge: t.quickCharge } : {}),
      }),
    );
    return typeof window !== "undefined"
      ? `${window.location.origin}/table?t=${encodeURIComponent(payload)}`
      : "";
  }

  const activeTables = tables.filter((t) => t.status !== "closed");
  const totalRevenue = tables
    .filter((t) => t.status === "closed" || t.paidAmount > 0)
    .reduce((s, t) => s + t.paidAmount, 0);
  const totalTips = tables.reduce(
    (s, t) => s + t.payments.reduce((ps, p) => ps + p.tip, 0),
    0,
  );

  const categories = [...new Set(catalogue.map((c) => c.category))];

  // --- Catalogue View ---
  if (view === "catalogue") {
    const DIETARY_OPTIONS = ["vegan", "vegetarian", "gluten-free", "halal", "contains-nuts", "dairy-free"];

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">
            ← Back
          </button>
          <p className="text-xs font-mono text-muted-foreground">{catalogue.length} items</p>
        </div>
        <p className="text-lg font-bold">Menu Catalogue</p>
        <p className="text-xs text-muted-foreground">Add items with prices, dietary info & routing (kitchen/bar).</p>

        {/* Add/Edit form */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">
            {editingCatId ? "Edit item" : "Add new item"}
          </p>
          <input
            type="text"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="Item name"
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
          />
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-1 bg-muted rounded-xl px-3 py-2.5">
              <span className="text-[10px] text-muted-foreground">KES</span>
              <input
                type="tel"
                value={catPrice}
                onChange={(e) => setCatPrice(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Price"
                className="flex-1 bg-transparent text-xs font-mono font-bold outline-none"
              />
            </div>
            <select
              value={catCategory}
              onChange={(e) => setCatCategory(e.target.value)}
              className="bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
            >
              {["Main", "Side", "Drinks", "Cocktails", "Snack", "Dessert", "Other"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          {/* Destination: Kitchen or Bar */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Goes to:</span>
            <button
              onClick={() => setCatDest("kitchen")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold ${catDest === "kitchen" ? "bg-orange-100 text-orange-700 border border-orange-300" : "bg-muted"}`}
            >
              🍳 Kitchen
            </button>
            <button
              onClick={() => setCatDest("bar")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold ${catDest === "bar" ? "bg-purple-100 text-purple-700 border border-purple-300" : "bg-muted"}`}
            >
              🍺 Bar
            </button>
          </div>
          {/* Dietary tags */}
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Dietary:</span>
            <div className="flex flex-wrap gap-1">
              {DIETARY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setCatDietary((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])}
                  className={`px-2 py-0.5 rounded-full text-[9px] border ${catDietary.includes(d) ? "bg-emerald-100 border-emerald-300 text-emerald-800" : "border-border text-muted-foreground"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                saveCatalogueItem();
                // Also save dietary and destination via direct catalogue update
                if (catName && catPrice) {
                  setCatalogue((prev) => prev.map((item) => {
                    if (item.name === catName) return { ...item, dietary: catDietary, destination: catDest };
                    return item;
                  }));
                }
                setCatDietary([]);
                setCatDest("kitchen");
              }}
              disabled={!catName || !catPrice}
              className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-40"
            >
              {editingCatId ? "Update" : "Add"}
            </button>
            {editingCatId && (
              <button
                onClick={() => { setEditingCatId(null); setCatName(""); setCatPrice(""); setCatCategory("Main"); setCatDietary([]); setCatDest("kitchen"); }}
                className="px-4 py-2.5 rounded-xl border border-border text-xs"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Items by category */}
        <div className="space-y-3 max-h-56 overflow-y-auto">
          {categories.map((cat) => (
            <div key={cat}>
              <p className="text-[9px] font-mono uppercase text-muted-foreground mb-1">{cat}</p>
              {catalogue
                .filter((c) => c.category === cat)
                .map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/50">
                    <div>
                      <p className="text-xs font-medium">
                        {item.destination === "bar" ? "🍺" : "🍳"} {item.name}
                      </p>
                      <div className="flex items-center gap-1">
                        <p className="text-[9px] text-muted-foreground font-mono">KES {item.price.toLocaleString()}</p>
                        {item.dietary && item.dietary.length > 0 && (
                          <span className="text-[8px] text-emerald-600">
                            {item.dietary.map((d) => d === "vegan" ? "🌱" : d === "vegetarian" ? "🥬" : d === "gluten-free" ? "🌾✗" : d === "halal" ? "☪" : d === "contains-nuts" ? "🥜" : "🥛✗").join("")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingCatId(item.id);
                          setCatName(item.name);
                          setCatPrice(String(item.price));
                          setCatCategory(item.category);
                          setCatDietary(item.dietary || []);
                          setCatDest(item.destination || "kitchen");
                        }}
                        className="size-6 rounded-full border border-border flex items-center justify-center"
                      >
                        <Pencil className="size-2.5" />
                      </button>
                      <button
                        onClick={() => deleteCatalogueItem(item.id)}
                        className="size-6 rounded-full border border-red-200 text-red-500 flex items-center justify-center"
                      >
                        <X className="size-2.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Quick Charge View ---
  if (view === "quick-charge") {
    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">
          ← Back
        </button>
        <p className="text-lg font-bold">Quick Charge</p>
        <p className="text-xs text-muted-foreground">Enter amount only — no line items needed. Perfect for bars, quick orders, or custom bills.</p>

        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="flex gap-2">
            <input
              type="tel"
              value={newTableNum}
              onChange={(e) => setNewTableNum(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="Table #"
              className="w-20 bg-muted rounded-xl px-3 py-3 text-sm font-mono outline-none text-center"
            />
            <select
              value={newTableServer}
              onChange={(e) => setNewTableServer(e.target.value)}
              className="flex-1 bg-muted rounded-xl px-3 py-3 text-xs outline-none"
            >
              {SERVERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-4">
            <span className="text-sm text-muted-foreground font-mono">KES</span>
            <input
              type="tel"
              value={quickAmount}
              onChange={(e) => setQuickAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="0"
              className="flex-1 bg-transparent text-3xl font-mono font-bold outline-none"
            />
          </div>
          <button
            onClick={createQuickChargeTable}
            disabled={!newTableNum || !quickAmount || Number(quickAmount) <= 0}
            className="w-full bg-emerald-600 text-white py-3.5 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Zap className="size-4" />
            Charge Table {newTableNum || "#"} — KES {quickAmount ? Number(quickAmount).toLocaleString() : "0"}
          </button>
        </div>

        <p className="text-[10px] text-center text-muted-foreground">
          A table QR will be generated. Customers scan → confirm → pay via M-Pesa.
        </p>
      </div>
    );
  }

  // --- Tips Analytics View ---
  if (view === "tips-analytics") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({ ...p, tableNumber: t.tableNumber, server: t.server })),
    );
    const serverTips: Record<string, { total: number; count: number }> = {};
    allPayments.forEach((p) => {
      if (!serverTips[p.server]) serverTips[p.server] = { total: 0, count: 0 };
      serverTips[p.server].total += p.tip;
      serverTips[p.server].count += 1;
    });
    const sortedServers = Object.entries(serverTips).sort((a, b) => b[1].total - a[1].total);
    const totalTipsAll = allPayments.reduce((s, p) => s + p.tip, 0);
    const avgTipPercent = allPayments.length > 0
      ? Math.round((totalTipsAll / allPayments.reduce((s, p) => s + p.amount, 0)) * 100)
      : 0;

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">
            ← Back
          </button>
          <p className="text-[10px] font-mono text-muted-foreground">{allPayments.length} transactions</p>
        </div>
        <p className="text-lg font-bold">Tips Analytics</p>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 p-3 text-center">
            <p className="text-lg font-bold font-mono text-amber-700">{totalTipsAll.toLocaleString()}</p>
            <p className="text-[9px] text-muted-foreground">Total tips (KES)</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">{avgTipPercent}%</p>
            <p className="text-[9px] text-muted-foreground">Avg tip rate</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">{allPayments.length}</p>
            <p className="text-[9px] text-muted-foreground">Payments</p>
          </div>
        </div>

        {/* Server leaderboard */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">Server leaderboard</p>
          {sortedServers.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No tips recorded yet</p>
          )}
          {sortedServers.map(([server, data], idx) => (
            <div key={server} className="flex items-center gap-3">
              <span className={`size-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                idx === 0 ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
              }`}>
                {idx + 1}
              </span>
              <div className="flex-1">
                <p className="text-xs font-medium">{server}</p>
                <p className="text-[9px] text-muted-foreground">{data.count} payments</p>
              </div>
              <p className="text-xs font-bold font-mono text-amber-600">KES {data.total.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* Recent tips */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">Recent tips</p>
          {allPayments.filter((p) => p.tip > 0).slice(0, 8).map((p, idx) => (
            <div key={idx} className="flex justify-between text-xs">
              <div>
                <span className="font-medium">{p.name || "Anonymous"}</span>
                <span className="text-muted-foreground ml-1">Table {p.tableNumber}</span>
              </div>
              <span className="font-mono font-bold text-amber-600">+{p.tip.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Payment History View ---
  if (view === "payment-history") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({ ...p, tableNumber: t.tableNumber, server: t.server, tableId: t.id })),
    );
    const filtered = allPayments.filter((p) => {
      if (newTableNum && p.tableNumber !== Number(newTableNum)) return false;
      return true;
    });
    const totalFiltered = filtered.reduce((s, p) => s + p.amount + p.tip, 0);

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => { setNewTableNum(""); setView("overview"); }} className="text-sm text-muted-foreground">
            ← Back
          </button>
          <p className="text-[10px] font-mono text-muted-foreground">
            {filtered.length} payments · KES {totalFiltered.toLocaleString()}
          </p>
        </div>
        <p className="text-lg font-bold">Payment History</p>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
            <span className="text-[10px] text-muted-foreground">Table #</span>
            <input
              type="tel"
              value={newTableNum}
              onChange={(e) => setNewTableNum(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="All"
              className="flex-1 bg-transparent text-xs font-mono outline-none"
            />
          </div>
          {newTableNum && (
            <button
              onClick={() => setNewTableNum("")}
              className="px-3 rounded-xl border border-border text-xs"
            >
              Clear
            </button>
          )}
        </div>

        {/* Payment list */}
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No payments found</p>
          )}
          {filtered.map((p, idx) => (
            <div key={idx} className="flex items-center justify-between py-2 px-3 rounded-xl border border-border">
              <div>
                <p className="text-xs font-medium">{p.name || "Anonymous"}</p>
                <p className="text-[9px] text-muted-foreground">
                  Table {p.tableNumber} · {p.server} · {p.phone}
                </p>
                <p className="text-[9px] text-muted-foreground">
                  {new Date(p.time).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold font-mono">{p.amount.toLocaleString()}</p>
                {p.tip > 0 && <p className="text-[9px] text-amber-600 font-mono">+{p.tip} tip</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- QR View ---
  if (view === "qr" && selectedTable) {
    const qrUrl = generateTableQR(selectedTable);
    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <button onClick={() => setView("detail")} className="text-sm text-muted-foreground">
          ← Back
        </button>
        <div className="text-center space-y-2">
          <p className="text-lg font-bold">Table {selectedTable.tableNumber} QR Code</p>
          <p className="text-xs text-muted-foreground">
            Print and place on table. Customers scan to view bill, split & pay.
          </p>
        </div>
        <div className="flex justify-center py-4">
          <div className="bg-white p-4 rounded-2xl shadow-lg">
            <QRCodeSVG value={qrUrl} size={200} level="H" />
          </div>
        </div>
        <div className="rounded-2xl bg-muted p-3 space-y-1">
          <p className="text-[10px] font-mono break-all text-muted-foreground">{qrUrl}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(qrUrl);
              toast.success("Link copied!");
            }}
            className="border border-border py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
          >
            <Copy className="size-3.5" />
            Copy link
          </button>
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: `Table ${selectedTable.tableNumber}`, url: qrUrl });
              } else {
                navigator.clipboard.writeText(qrUrl);
                toast.success("Link copied!");
              }
            }}
            className="border border-border py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
          >
            <Share2 className="size-3.5" />
            Share
          </button>
        </div>
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">Customer gets:</p>
          <div className="space-y-1 text-xs">
            <p>✓ Full itemized bill</p>
            <p>✓ Split equally, by item, or custom amount</p>
            <p>✓ Leave tip for {selectedTable.server}</p>
            <p>✓ Instant M-Pesa STK Push payment</p>
            <p>✓ Auto-calculated remaining balance</p>
          </div>
        </div>
      </div>
    );
  }

  // --- Add Items View ---
  if (view === "add-items" && selectedTable) {
    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("detail")} className="text-sm text-muted-foreground">
            ← Back
          </button>
          <p className="text-xs font-mono text-muted-foreground">Table {selectedTable.tableNumber}</p>
        </div>
        <p className="text-lg font-bold">Add items to order</p>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {catalogue.map((item) => {
            const qty = addingItems.get(item.id) ?? 0;
            return (
              <div key={item.id} className="flex items-center justify-between py-2 px-3 rounded-xl border border-border">
                <div>
                  <p className="text-xs font-medium">{item.name}</p>
                  <p className="text-[9px] text-muted-foreground">{item.category} · KES {item.price}</p>
                </div>
                <div className="flex items-center gap-2">
                  {qty > 0 && (
                    <button
                      onClick={() => {
                        const m = new Map(addingItems);
                        m.set(item.id, qty - 1);
                        if (qty - 1 <= 0) m.delete(item.id);
                        setAddingItems(m);
                      }}
                      className="size-7 rounded-full border border-border flex items-center justify-center"
                    >
                      <Minus className="size-3" />
                    </button>
                  )}
                  {qty > 0 && (
                    <span className="text-sm font-bold font-mono w-4 text-center">{qty}</span>
                  )}
                  <button
                    onClick={() => {
                      const m = new Map(addingItems);
                      m.set(item.id, qty + 1);
                      setAddingItems(m);
                    }}
                    className="size-7 rounded-full bg-foreground text-background flex items-center justify-center"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {addingItems.size > 0 && (
          <div className="rounded-xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">
              Adding {Array.from(addingItems.values()).reduce((s, q) => s + q, 0)} items ·{" "}
              <span className="font-bold">
                KES{" "}
                {Array.from(addingItems.entries())
                  .reduce((s, [id, q]) => s + (catalogue.find((m) => m.id === id)?.price ?? 0) * q, 0)
                  .toLocaleString()}
              </span>
            </p>
          </div>
        )}
        <button
          onClick={addItemsToTable}
          disabled={addingItems.size === 0}
          className="w-full bg-emerald-600 text-white py-3.5 rounded-xl text-sm font-bold disabled:opacity-40"
        >
          Add to order
        </button>
      </div>
    );
  }

  // --- Table Detail View ---
  if (view === "detail" && selectedTable) {
    const total = getTotal(selectedTable);
    const remaining = getRemainingBalance(selectedTable);
    const elapsed = Math.round((Date.now() - new Date(selectedTable.openedAt).getTime()) / 60000);

    return (
      <div className="px-5 pt-4 pb-20 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => { setSelectedTable(null); setView("overview"); }} className="text-sm text-muted-foreground">
            ← All tables
          </button>
          <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono uppercase ${
            selectedTable.status === "open" ? "bg-emerald-100 text-emerald-700" :
            selectedTable.status === "requesting-bill" ? "bg-amber-100 text-amber-700" :
            selectedTable.status === "partially-paid" ? "bg-blue-100 text-blue-700" :
            "bg-muted text-muted-foreground"
          }`}>
            {selectedTable.status.replace("-", " ")}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-bold">Table {selectedTable.tableNumber}</p>
            <p className="text-xs text-muted-foreground">
              Server: {selectedTable.server} · {elapsed} min
            </p>
          </div>
          <div className="size-12 rounded-full bg-foreground text-background flex items-center justify-center text-lg font-bold">
            {selectedTable.tableNumber}
          </div>
        </div>

        {/* Items */}
        <div className="rounded-xl border border-border overflow-hidden">
          <p className="text-[10px] font-mono uppercase text-muted-foreground px-3 pt-2">
            Order ({selectedTable.items.length} items)
          </p>
          <div className="divide-y divide-border">
            {selectedTable.items.map((item, idx) => (
              <div key={idx} className="px-3 py-2 flex justify-between">
                <div>
                  <p className="text-xs font-medium">{item.name}</p>
                  <p className="text-[9px] text-muted-foreground">×{item.qty} · {item.category}</p>
                </div>
                <p className="text-xs font-mono font-bold">{(item.price * item.qty).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-xl bg-muted p-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Total</span>
            <span className="font-bold font-mono">KES {total.toLocaleString()}</span>
          </div>
          {selectedTable.paidAmount > 0 && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-mono text-emerald-600">-KES {selectedTable.paidAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs font-bold">
                <span>Remaining</span>
                <span className="font-mono text-amber-600">KES {remaining.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (selectedTable.paidAmount / total) * 100)}%` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Payments */}
        {selectedTable.payments.length > 0 && (
          <div className="rounded-xl border border-border p-3 space-y-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Payments received</p>
            {selectedTable.payments.map((p, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-medium">{p.name || "Anonymous"}</span>
                  <span className="text-muted-foreground ml-1">({p.phone})</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className="font-mono font-bold">{p.amount.toLocaleString()}</span>
                    {p.tip > 0 && <span className="text-amber-600 ml-1">+{p.tip} tip</span>}
                  </div>
                  <button
                    onClick={async () => {
                      const refundAmt = p.amount + p.tip;
                      if (!confirm(`Refund KES ${refundAmt.toLocaleString()} to ${p.name || "customer"}?`)) return;

                      try {
                        // Call PesaSwap refund API
                        await pesaswapClient.processRefund({
                          payment_id: (p as Record<string, unknown>).paymentId as string || `pay_${selectedTable.id}_${idx}`,
                          amount: refundAmt * 100, // minor units
                          reason: "customer_request",
                          items: selectedTable.items?.map((it) => ({
                            id: it.id,
                            name: it.name,
                            price: it.price,
                            qty: it.qty,
                          })),
                          refunded_by: selectedTable.server || "merchant",
                        });

                        setTables((prev) =>
                          prev.map((t) =>
                            t.id === selectedTable.id
                              ? {
                                  ...t,
                                  paidAmount: Math.max(0, t.paidAmount - refundAmt),
                                  payments: t.payments.map((pay, i) =>
                                    i === idx ? { ...pay, amount: 0, tip: 0, name: `${pay.name} (REFUNDED)` } : pay,
                                  ),
                                }
                              : t,
                          ),
                        );
                        setSelectedTable({
                          ...selectedTable,
                          paidAmount: Math.max(0, selectedTable.paidAmount - refundAmt),
                          payments: selectedTable.payments.map((pay, i) =>
                            i === idx ? { ...pay, amount: 0, tip: 0, name: `${pay.name} (REFUNDED)` } : pay,
                          ),
                        });
                        toast.success(`Refund of KES ${refundAmt.toLocaleString()} processed via PesaSwap`);
                      } catch (err) {
                        toast.error("Refund failed: " + (err instanceof Error ? err.message : "Unknown error"));
                      }
                    }}
                    disabled={p.amount === 0}
                    className="text-[9px] text-red-500 border border-red-200 px-1.5 py-0.5 rounded disabled:opacity-30"
                  >
                    Refund
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setView("qr")}
            className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <QrCode className="size-3.5" />
            Table QR
          </button>
          <button
            onClick={() => { setAddingItems(new Map()); setView("add-items"); }}
            className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Plus className="size-3.5" />
            Add items
          </button>
        </div>

        {selectedTable.status !== "closed" && remaining <= 0 && selectedTable.paidAmount > 0 && (
          <button
            onClick={() => closeTable(selectedTable.id)}
            className="w-full bg-foreground text-background py-3 rounded-xl text-xs font-bold"
          >
            Close table (fully paid)
          </button>
        )}

        {selectedTable.status !== "closed" && remaining > 0 && (
          <button
            onClick={() => {
              const payment = { name: "Walk-in", amount: remaining, tip: Math.round(remaining * 0.1), phone: "+254711***XXX", time: new Date().toISOString() };
              const newPaid = selectedTable.paidAmount + payment.amount + payment.tip;
              const total = getTotal(selectedTable);
              const autoClose = newPaid >= total;
              setTables((prev) =>
                prev.map((t) =>
                  t.id === selectedTable.id
                    ? { ...t, paidAmount: newPaid, payments: [...t.payments, payment], status: autoClose ? "closed" as const : "partially-paid" as const }
                    : t,
                ),
              );
              // Staff notification
              notifyStaff(selectedTable.tableNumber, payment.amount, payment.name);
              if (autoClose) {
                setSelectedTable(null);
                setView("overview");
              } else {
                setSelectedTable({ ...selectedTable, paidAmount: newPaid, payments: [...selectedTable.payments, payment], status: "partially-paid" });
              }
            }}
            className="w-full border border-emerald-300 text-emerald-700 py-3 rounded-xl text-xs font-bold"
          >
            Simulate payment (demo)
          </button>
        )}
      </div>
    );
  }

  // --- AI Revenue Forecast View ---
  if (view === "ai-forecast") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({ ...p, tableNumber: t.tableNumber, openedAt: t.openedAt })),
    );
    // Group by day
    const dailyRevenue: Record<string, number> = {};
    allPayments.forEach((p) => {
      const day = new Date(p.time).toLocaleDateString("en-KE", { weekday: "short" });
      dailyRevenue[day] = (dailyRevenue[day] || 0) + p.amount + p.tip;
    });
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayData = days.map((d) => ({ day: d, revenue: dailyRevenue[d] || 0 }));
    const maxDay = Math.max(...dayData.map((d) => d.revenue), 1);
    const avgDaily = allPayments.length > 0
      ? Math.round(allPayments.reduce((s, p) => s + p.amount + p.tip, 0) / Math.max(Object.keys(dailyRevenue).length, 1))
      : 0;
    const totalWeek = dayData.reduce((s, d) => s + d.revenue, 0);
    // Simple linear projection: avg * 7
    const projectedWeekly = avgDaily * 7;
    const trend = projectedWeekly > totalWeek ? "up" : projectedWeekly < totalWeek ? "down" : "flat";
    // Peak hour analysis
    const hourBuckets: Record<number, number> = {};
    allPayments.forEach((p) => {
      const h = new Date(p.time).getHours();
      hourBuckets[h] = (hourBuckets[h] || 0) + p.amount + p.tip;
    });
    const peakHour = Object.entries(hourBuckets).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    const avgPerTable = tables.length > 0
      ? Math.round(allPayments.reduce((s, p) => s + p.amount + p.tip, 0) / tables.filter((t) => t.payments.length > 0).length || 0)
      : 0;

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">← Back</button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">AI Powered</span>
          </div>
        </div>
        <p className="text-lg font-bold">Revenue Forecast</p>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono text-emerald-600">{avgDaily.toLocaleString()}</p>
            <p className="text-[9px] text-muted-foreground uppercase">Avg/Day</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">{projectedWeekly.toLocaleString()}</p>
            <p className="text-[9px] text-muted-foreground uppercase">Proj. Week</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className={`text-lg font-bold font-mono ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : ""}`}>
              {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">Trend</p>
          </div>
        </div>

        {/* Weekly bar chart */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-xs font-semibold">Revenue by Day</p>
          <div className="flex items-end gap-1.5 h-24">
            {dayData.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-emerald-500/80 min-h-[2px] transition-all"
                  style={{ height: `${(d.revenue / maxDay) * 100}%` }}
                />
                <span className="text-[8px] text-muted-foreground">{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Insights */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5"><Brain className="size-3" /> AI Insights</p>
          <div className="space-y-1.5">
            {peakHour && (
              <p className="text-[11px] text-muted-foreground">
                💰 Peak revenue hour: <span className="font-semibold text-foreground">{Number(peakHour[0]) % 12 || 12}{Number(peakHour[0]) >= 12 ? "PM" : "AM"}</span> (KES {Number(peakHour[1]).toLocaleString()})
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              📊 Avg spend per table: <span className="font-semibold text-foreground">KES {avgPerTable.toLocaleString()}</span>
            </p>
            {trend === "up" && (
              <p className="text-[11px] text-emerald-600">📈 Revenue trending upward — consider extending peak-hour capacity</p>
            )}
            {trend === "down" && (
              <p className="text-[11px] text-red-600">📉 Revenue below projection — review menu pricing or promotions</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              🎯 To hit KES {(projectedWeekly * 1.2).toLocaleString()}/week, aim for {Math.ceil(avgPerTable > 0 ? (projectedWeekly * 0.2) / avgPerTable : 3)} more tables/day
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- AI Smart Staffing View ---
  if (view === "ai-staffing") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({ ...p, tableNumber: t.tableNumber, server: t.server })),
    );
    // Group by hour
    const hourlyLoad: Record<number, number> = {};
    allPayments.forEach((p) => {
      const h = new Date(p.time).getHours();
      hourlyLoad[h] = (hourlyLoad[h] || 0) + 1;
    });
    const hours = Array.from({ length: 14 }, (_, i) => i + 8); // 8AM-9PM
    const hourData = hours.map((h) => ({ hour: h, count: hourlyLoad[h] || 0 }));
    const maxHourCount = Math.max(...hourData.map((h) => h.count), 1);

    // Server performance
    const serverStats: Record<string, { tables: number; revenue: number; tips: number }> = {};
    tables.forEach((t) => {
      if (!serverStats[t.server]) serverStats[t.server] = { tables: 0, revenue: 0, tips: 0 };
      serverStats[t.server].tables += 1;
      t.payments.forEach((p) => {
        serverStats[t.server].revenue += p.amount;
        serverStats[t.server].tips += p.tip;
      });
    });
    const serverList = Object.entries(serverStats).sort((a, b) => b[1].revenue - a[1].revenue);

    // Suggest staffing
    const peakHours = hourData.filter((h) => h.count >= maxHourCount * 0.7).map((h) => h.hour);
    const quietHours = hourData.filter((h) => h.count > 0 && h.count <= maxHourCount * 0.3).map((h) => h.hour);
    const currentActive = activeTables.length;
    const suggestedStaff = Math.max(1, Math.ceil(currentActive / 4)); // 4 tables per server

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">← Back</button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">AI Powered</span>
          </div>
        </div>
        <p className="text-lg font-bold">Smart Staffing</p>

        {/* Current recommendation */}
        <div className="rounded-2xl border-2 border-purple-200 bg-purple-50 dark:bg-purple-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-purple-600" />
            <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">Right Now</p>
          </div>
          <p className="text-2xl font-bold font-mono text-purple-700 dark:text-purple-300">{suggestedStaff} servers needed</p>
          <p className="text-[10px] text-purple-600 dark:text-purple-400">
            {currentActive} active tables · optimal ratio 1:4
          </p>
        </div>

        {/* Hourly heatmap */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-xs font-semibold">Hourly Traffic Heatmap</p>
          <div className="grid grid-cols-7 gap-1">
            {hourData.map((h) => {
              const intensity = h.count / maxHourCount;
              const bg = intensity > 0.7
                ? "bg-red-500"
                : intensity > 0.4
                ? "bg-amber-400"
                : intensity > 0
                ? "bg-emerald-300"
                : "bg-muted";
              return (
                <div key={h.hour} className="flex flex-col items-center gap-0.5">
                  <div className={`w-full aspect-square rounded ${bg} opacity-80`} />
                  <span className="text-[7px] text-muted-foreground">{h.hour % 12 || 12}{h.hour >= 12 ? "p" : "a"}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-[8px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-red-500" /> Peak</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-amber-400" /> Busy</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-emerald-300" /> Normal</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-muted border" /> Quiet</span>
          </div>
        </div>

        {/* AI suggestions */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5"><Brain className="size-3" /> Recommendations</p>
          <div className="space-y-1.5">
            {peakHours.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                🔥 Peak hours: <span className="font-semibold text-foreground">
                  {peakHours.map((h) => `${h % 12 || 12}${h >= 12 ? "PM" : "AM"}`).join(", ")}
                </span> — schedule extra staff
              </p>
            )}
            {quietHours.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                😴 Quiet hours: <span className="font-semibold text-foreground">
                  {quietHours.map((h) => `${h % 12 || 12}${h >= 12 ? "PM" : "AM"}`).join(", ")}
                </span> — reduce to {Math.max(1, suggestedStaff - 1)} staff
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              👥 Top performer: <span className="font-semibold text-foreground">{serverList[0]?.[0] || "—"}</span>
              {serverList[0] ? ` (KES ${serverList[0][1].revenue.toLocaleString()} revenue)` : ""}
            </p>
          </div>
        </div>

        {/* Server table */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold">Server Performance</p>
          <div className="space-y-1">
            {serverList.map(([name, stats]) => (
              <div key={name} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <div>
                  <p className="text-xs font-medium">{name}</p>
                  <p className="text-[9px] text-muted-foreground">{stats.tables} tables</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono">{stats.revenue.toLocaleString()}</p>
                  <p className="text-[9px] text-amber-600">+{stats.tips.toLocaleString()} tips</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- AI Customer Insights View ---
  if (view === "ai-insights") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({ ...p, tableNumber: t.tableNumber, server: t.server, openedAt: t.openedAt, closedAt: t.closedAt })),
    );
    // Average dwell time (for closed tables)
    const closedTables = tables.filter((t) => t.status === "closed" && t.closedAt);
    const avgDwell = closedTables.length > 0
      ? Math.round(closedTables.reduce((s, t) => s + (new Date(t.closedAt!).getTime() - new Date(t.openedAt).getTime()), 0) / closedTables.length / 60000)
      : 0;
    // Popular items
    const itemCounts: Record<string, number> = {};
    tables.forEach((t) => t.items.forEach((item) => {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
    }));
    const popularItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxItemQty = popularItems[0]?.[1] || 1;
    // Peak hours
    const hourCounts: Record<number, number> = {};
    allPayments.forEach((p) => {
      const h = new Date(p.time).getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    });
    // Avg spend per customer
    const avgSpend = allPayments.length > 0
      ? Math.round(allPayments.reduce((s, p) => s + p.amount + p.tip, 0) / allPayments.length)
      : 0;
    // Repeat customers (same phone)
    const phoneCounts: Record<string, number> = {};
    allPayments.forEach((p) => {
      if (p.phone) phoneCounts[p.phone] = (phoneCounts[p.phone] || 0) + 1;
    });
    const repeatCustomers = Object.values(phoneCounts).filter((c) => c > 1).length;
    const totalCustomers = Object.keys(phoneCounts).length;
    const repeatRate = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0;
    // Table utilization
    const tableUtilization = tables.length > 0
      ? Math.round((activeTables.length / Math.max(tables.length, 1)) * 100)
      : 0;

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">← Back</button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">AI Powered</span>
          </div>
        </div>
        <p className="text-lg font-bold">Customer Insights</p>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Avg Dwell", value: `${avgDwell}m`, sub: "time at table" },
            { label: "Avg Spend", value: `${avgSpend.toLocaleString()}`, sub: "per customer" },
            { label: "Repeat Rate", value: `${repeatRate}%`, sub: `${repeatCustomers} of ${totalCustomers}` },
            { label: "Utilization", value: `${tableUtilization}%`, sub: "tables in use" },
          ].map((m) => (
            <div key={m.label} className="rounded-xl bg-muted p-3">
              <p className="text-lg font-bold font-mono">{m.value}</p>
              <p className="text-[9px] text-muted-foreground uppercase">{m.label}</p>
              <p className="text-[8px] text-muted-foreground">{m.sub}</p>
            </div>
          ))}
        </div>

        {/* Popular items */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-xs font-semibold">🏆 Most Popular Items</p>
          {popularItems.length === 0 && (
            <p className="text-[10px] text-muted-foreground">No item data yet</p>
          )}
          <div className="space-y-1.5">
            {popularItems.map(([name, qty], i) => (
              <div key={name} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-4">{i + 1}.</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium">{name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">×{qty}</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted mt-0.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${(qty / maxItemQty) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Behavior patterns */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5"><Brain className="size-3" /> Behavior Patterns</p>
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              ⏱️ Customers stay an average of <span className="font-semibold text-foreground">{avgDwell} minutes</span>
              {avgDwell > 60 ? " — consider table turnover strategies" : avgDwell > 0 ? " — healthy turnover rate" : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              🔄 <span className="font-semibold text-foreground">{repeatRate}%</span> of customers return
              {repeatRate > 30 ? " — excellent loyalty!" : repeatRate > 0 ? " — room to improve retention" : ""}
            </p>
            {popularItems[0] && (
              <p className="text-[11px] text-muted-foreground">
                ⭐ Top seller: <span className="font-semibold text-foreground">{popularItems[0][0]}</span> — consider upsell bundles
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              💡 Tip: Items ordered together often make great combo deals
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- AI Anomaly Detection View ---
  if (view === "ai-anomalies") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({ ...p, tableNumber: t.tableNumber, server: t.server })),
    );
    // Detect anomalies
    type Anomaly = { severity: "high" | "medium" | "low"; title: string; detail: string; icon: string };
    const anomalies: Anomaly[] = [];

    // 1. Low tip rate tables
    const tableTipRates = tables
      .filter((t) => t.payments.length > 0)
      .map((t) => {
        const totalPaid = t.payments.reduce((s, p) => s + p.amount, 0);
        const totalTips = t.payments.reduce((s, p) => s + p.tip, 0);
        return { table: t.tableNumber, server: t.server, tipRate: totalPaid > 0 ? totalTips / totalPaid : 0 };
      });
    const zeroTipTables = tableTipRates.filter((t) => t.tipRate === 0);
    if (zeroTipTables.length > 2) {
      anomalies.push({
        severity: "medium",
        title: "Low Tipping Pattern",
        detail: `${zeroTipTables.length} tables left no tip. Servers: ${[...new Set(zeroTipTables.map((t) => t.server))].join(", ")}`,
        icon: "💰",
      });
    }

    // 2. Walkout risk (open tables with no payment for 2h+)
    if (walkoutRiskTables.length > 0) {
      anomalies.push({
        severity: "high",
        title: "Walkout Risk Detected",
        detail: `Tables ${walkoutRiskTables.map((t) => t.tableNumber).join(", ")} open 2h+ with no payment`,
        icon: "🚨",
      });
    }

    // 3. Revenue drop detection (compare recent vs older)
    const now = Date.now();
    const recentPayments = allPayments.filter((p) => now - new Date(p.time).getTime() < 3600000 * 3);
    const olderPayments = allPayments.filter((p) => {
      const age = now - new Date(p.time).getTime();
      return age >= 3600000 * 3 && age < 3600000 * 6;
    });
    const recentRev = recentPayments.reduce((s, p) => s + p.amount + p.tip, 0);
    const olderRev = olderPayments.reduce((s, p) => s + p.amount + p.tip, 0);
    if (olderRev > 0 && recentRev < olderRev * 0.5) {
      anomalies.push({
        severity: "medium",
        title: "Revenue Drop",
        detail: `Last 3h revenue (KES ${recentRev.toLocaleString()}) is ${Math.round((1 - recentRev / olderRev) * 100)}% below previous period`,
        icon: "📉",
      });
    }

    // 4. Unusually high transaction
    const avgPayment = allPayments.length > 0
      ? allPayments.reduce((s, p) => s + p.amount, 0) / allPayments.length
      : 0;
    const highPayments = allPayments.filter((p) => p.amount > avgPayment * 3 && avgPayment > 0);
    if (highPayments.length > 0) {
      anomalies.push({
        severity: "low",
        title: "Unusually Large Payments",
        detail: `${highPayments.length} payment(s) 3x above average (KES ${Math.round(avgPayment).toLocaleString()} avg)`,
        icon: "⚠️",
      });
    }

    // 5. Server tip disparity
    const serverTips: Record<string, { total: number; count: number }> = {};
    allPayments.forEach((p) => {
      if (!serverTips[p.server]) serverTips[p.server] = { total: 0, count: 0 };
      serverTips[p.server].total += p.tip;
      serverTips[p.server].count += 1;
    });
    const serverAvgs = Object.entries(serverTips)
      .filter(([, s]) => s.count > 0)
      .map(([name, s]) => ({ name, avg: s.total / s.count }));
    if (serverAvgs.length >= 2) {
      const maxAvg = Math.max(...serverAvgs.map((s) => s.avg));
      const minAvg = Math.min(...serverAvgs.map((s) => s.avg));
      if (maxAvg > 0 && minAvg < maxAvg * 0.3) {
        const lowServer = serverAvgs.find((s) => s.avg === minAvg);
        anomalies.push({
          severity: "low",
          title: "Tip Disparity",
          detail: `${lowServer?.name} receiving significantly lower tips — may need service coaching`,
          icon: "👤",
        });
      }
    }

    // 6. Long table times (closed tables that took unusually long)
    const closedWithTimes = tables.filter((t) => t.status === "closed" && t.closedAt);
    const dwellTimes = closedWithTimes.map((t) => (new Date(t.closedAt!).getTime() - new Date(t.openedAt).getTime()) / 60000);
    const avgDwell = dwellTimes.length > 0 ? dwellTimes.reduce((s, d) => s + d, 0) / dwellTimes.length : 0;
    const longTables = closedWithTimes.filter((t) => {
      const dwell = (new Date(t.closedAt!).getTime() - new Date(t.openedAt).getTime()) / 60000;
      return dwell > avgDwell * 2 && avgDwell > 0;
    });
    if (longTables.length > 0) {
      anomalies.push({
        severity: "low",
        title: "Extended Table Times",
        detail: `${longTables.length} table(s) took 2x longer than average (${Math.round(avgDwell)}min avg)`,
        icon: "⏰",
      });
    }

    const severityOrder = { high: 0, medium: 1, low: 2 };
    anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">← Back</button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">AI Powered</span>
          </div>
        </div>
        <p className="text-lg font-bold">Anomaly Detection</p>

        {/* Status badge */}
        <div className={`rounded-2xl p-4 text-center ${anomalies.length === 0 ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200" : "bg-amber-50 dark:bg-amber-950/20 border border-amber-200"}`}>
          <p className="text-2xl">{anomalies.length === 0 ? "✅" : "⚡"}</p>
          <p className={`text-sm font-semibold mt-1 ${anomalies.length === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
            {anomalies.length === 0 ? "All Clear" : `${anomalies.length} Issue${anomalies.length > 1 ? "s" : ""} Detected`}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {anomalies.length === 0 ? "No anomalies detected — operations running smoothly" : "Review items below for potential action"}
          </p>
        </div>

        {/* Anomaly cards */}
        <div className="space-y-2">
          {anomalies.map((a, i) => (
            <div
              key={i}
              className={`rounded-xl border p-3 space-y-1 ${
                a.severity === "high"
                  ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                  : a.severity === "medium"
                  ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
                  : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{a.icon}</span>
                <p className={`text-xs font-semibold ${
                  a.severity === "high" ? "text-red-700 dark:text-red-300" : a.severity === "medium" ? "text-amber-700 dark:text-amber-300" : ""
                }`}>{a.title}</p>
                <span className={`ml-auto text-[8px] font-mono uppercase px-1.5 py-0.5 rounded-full ${
                  a.severity === "high" ? "bg-red-200 text-red-800" : a.severity === "medium" ? "bg-amber-200 text-amber-800" : "bg-muted text-muted-foreground"
                }`}>{a.severity}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">{a.detail}</p>
            </div>
          ))}
        </div>

        {/* Monitoring status */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold">Monitoring Active</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Tip Rates", status: "✓" },
              { label: "Walkout Risk", status: "✓" },
              { label: "Revenue Drops", status: "✓" },
              { label: "Large Payments", status: "✓" },
              { label: "Staff Performance", status: "✓" },
              { label: "Table Times", status: "✓" },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-1.5">
                <span className="text-[9px] text-emerald-600">{m.status}</span>
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Orders Queue (Kitchen/Bar Display) ---
  if (view === "orders-queue") {
    const filteredOrders = orders.filter((o) => ordersFilter === "all" || o.destination === ordersFilter);
    const newOrders2 = filteredOrders.filter((o) => o.status === "new");
    const preparingOrders = filteredOrders.filter((o) => o.status === "preparing");
    const readyOrders = filteredOrders.filter((o) => o.status === "ready");

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">← Back</button>
          <p className="text-[10px] font-mono text-muted-foreground">{filteredOrders.length} orders</p>
        </div>
        <p className="text-lg font-bold">Orders Queue</p>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-muted rounded-xl p-1">
          {(["all", "kitchen", "bar"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setOrdersFilter(f)}
              className={`flex-1 py-2 rounded-lg text-[10px] font-semibold capitalize ${ordersFilter === f ? "bg-background shadow-sm" : ""}`}
            >
              {f === "kitchen" ? "🍳 " : f === "bar" ? "🍺 " : ""}{f}
            </button>
          ))}
        </div>

        {/* New orders */}
        {newOrders2.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-red-600 flex items-center gap-1">
              <span className="size-2 rounded-full bg-red-500 animate-pulse" /> NEW ({newOrders2.length})
            </p>
            {newOrders2.map((o) => (
              <div key={o.id} className="rounded-xl border-2 border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">Table {o.tableNumber} · {o.destination === "bar" ? "🍺 Bar" : "🍳 Kitchen"}</p>
                  <span className="text-[8px] text-muted-foreground">{new Date(o.orderedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                {o.items.map((item, i) => (
                  <p key={i} className="text-[11px]">× {item.qty} {item.name}{item.notes ? ` (${item.notes})` : ""}</p>
                ))}
                <p className="text-[9px] text-muted-foreground">Server: {o.server}{o.customerName ? ` · Customer: ${o.customerName}` : ""}</p>
                <button
                  onClick={() => updateOrderStatus(o.id, "preparing")}
                  className="w-full bg-orange-500 text-white py-2 rounded-xl text-xs font-bold mt-1"
                >
                  Start Preparing
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Preparing */}
        {preparingOrders.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-orange-600">🔥 PREPARING ({preparingOrders.length})</p>
            {preparingOrders.map((o) => (
              <div key={o.id} className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">Table {o.tableNumber} · {o.destination === "bar" ? "🍺" : "🍳"}</p>
                  <span className="text-[8px] text-muted-foreground">{Math.round((Date.now() - new Date(o.orderedAt).getTime()) / 60000)}m ago</span>
                </div>
                {o.items.map((item, i) => (
                  <p key={i} className="text-[11px]">× {item.qty} {item.name}</p>
                ))}
                <button
                  onClick={() => updateOrderStatus(o.id, "ready")}
                  className="w-full bg-emerald-600 text-white py-2 rounded-xl text-xs font-bold mt-1"
                >
                  ✓ Mark Ready
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Ready for pickup */}
        {readyOrders.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-emerald-600">✅ READY ({readyOrders.length})</p>
            {readyOrders.map((o) => (
              <div key={o.id} className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">Table {o.tableNumber} · {o.destination === "bar" ? "🍺" : "🍳"}</p>
                  <span className="text-[8px] text-emerald-600 font-semibold">READY</span>
                </div>
                {o.items.map((item, i) => (
                  <p key={i} className="text-[11px]">× {item.qty} {item.name}</p>
                ))}
                <button
                  onClick={() => updateOrderStatus(o.id, "served")}
                  className="w-full border border-emerald-300 text-emerald-700 py-2 rounded-xl text-xs font-bold mt-1"
                >
                  Served ✓
                </button>
              </div>
            ))}
          </div>
        )}

        {filteredOrders.length === 0 && (
          <div className="text-center py-8">
            <p className="text-2xl">👨‍🍳</p>
            <p className="text-xs text-muted-foreground mt-2">No active orders</p>
            <p className="text-[10px] text-muted-foreground">Orders from tables will appear here in real time</p>
          </div>
        )}
      </div>
    );
  }

  // --- Reservations View ---
  if (view === "reservations") {
    function createReservation() {
      if (!resName || !resPhone || !resTable) return;
      const newRes: Reservation = {
        id: `res-${Date.now()}`,
        tableNumber: Number(resTable),
        customerName: resName,
        phone: resPhone,
        date: resDate,
        time: resTime,
        covers: Number(resCovers) || 2,
        status: "confirmed",
      };
      setReservations((prev) => [...prev, newRes]);
      setResName(""); setResPhone(""); setResTable("");
      toast.success(`Reservation confirmed: Table ${resTable} at ${resTime}`);
    }

    const todayRes = reservations.filter((r) => r.date === new Date().toISOString().slice(0, 10));
    const upcomingRes = reservations.filter((r) => r.date > new Date().toISOString().slice(0, 10) && r.status === "confirmed");

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">← Back</button>
          <p className="text-[10px] font-mono text-muted-foreground">{reservations.length} total</p>
        </div>
        <p className="text-lg font-bold">Table Reservations</p>

        {/* New reservation form */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">New Reservation</p>
          <input
            type="text" value={resName} onChange={(e) => setResName(e.target.value)}
            placeholder="Customer name" className="w-full bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
          />
          <input
            type="tel" value={resPhone} onChange={(e) => setResPhone(e.target.value)}
            placeholder="Phone (0712...)" className="w-full bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
          />
          <div className="flex gap-2">
            <input type="date" value={resDate} onChange={(e) => setResDate(e.target.value)}
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-xs outline-none" />
            <input type="time" value={resTime} onChange={(e) => setResTime(e.target.value)}
              className="w-24 bg-muted rounded-xl px-3 py-2.5 text-xs outline-none" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-1 bg-muted rounded-xl px-3 py-2.5">
              <span className="text-[10px] text-muted-foreground">Table #</span>
              <input type="tel" value={resTable} onChange={(e) => setResTable(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                className="flex-1 bg-transparent text-xs font-mono outline-none" />
            </div>
            <div className="flex items-center gap-1 bg-muted rounded-xl px-3 py-2.5">
              <span className="text-[10px] text-muted-foreground">Covers</span>
              <input type="tel" value={resCovers} onChange={(e) => setResCovers(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                className="w-8 bg-transparent text-xs font-mono outline-none text-center" />
            </div>
          </div>
          <button
            onClick={createReservation}
            disabled={!resName || !resPhone || !resTable}
            className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-40"
          >
            Confirm Reservation
          </button>
        </div>

        {/* Today's reservations */}
        {todayRes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Today ({todayRes.length})</p>
            {todayRes.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">{r.customerName}</p>
                  <p className="text-[9px] text-muted-foreground">Table {r.tableNumber} · {r.time} · {r.covers} covers</p>
                </div>
                <div className="flex gap-1">
                  {r.status === "confirmed" && (
                    <button
                      onClick={() => setReservations((prev) => prev.map((x) => x.id === r.id ? { ...x, status: "seated" } : x))}
                      className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-[9px] font-semibold"
                    >
                      Seat
                    </button>
                  )}
                  {r.status === "confirmed" && (
                    <button
                      onClick={() => setReservations((prev) => prev.map((x) => x.id === r.id ? { ...x, status: "no-show" } : x))}
                      className="px-2 py-1 rounded-lg bg-red-100 text-red-700 text-[9px] font-semibold"
                    >
                      No-show
                    </button>
                  )}
                  <span className={`px-2 py-1 rounded-lg text-[9px] font-semibold ${
                    r.status === "seated" ? "bg-emerald-100 text-emerald-700" :
                    r.status === "no-show" ? "bg-red-100 text-red-700" :
                    r.status === "cancelled" ? "bg-muted text-muted-foreground" :
                    "bg-blue-100 text-blue-700"
                  }`}>
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Upcoming */}
        {upcomingRes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Upcoming ({upcomingRes.length})</p>
            {upcomingRes.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">{r.customerName}</p>
                  <p className="text-[9px] text-muted-foreground">Table {r.tableNumber} · {r.date} {r.time} · {r.covers} pax</p>
                </div>
                <button
                  onClick={() => setReservations((prev) => prev.map((x) => x.id === r.id ? { ...x, status: "cancelled" } : x))}
                  className="px-2 py-1 rounded-lg border border-red-200 text-red-600 text-[9px]"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        {reservations.length === 0 && (
          <div className="text-center py-8">
            <p className="text-2xl">📅</p>
            <p className="text-xs text-muted-foreground mt-2">No reservations yet</p>
          </div>
        )}
      </div>
    );
  }

  // --- Loyalty & Rewards View ---
  if (view === "loyalty") {
    const TIER_COLORS = { Bronze: "text-amber-700 bg-amber-100", Silver: "text-gray-700 bg-gray-100", Gold: "text-yellow-700 bg-yellow-100", Platinum: "text-purple-700 bg-purple-100" };
    const totalPoints = loyaltyCustomers.reduce((s, c) => s + c.points, 0);
    const sortedCustomers = [...loyaltyCustomers].sort((a, b) => b.totalSpent - a.totalSpent);

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("overview")} className="text-sm text-muted-foreground">← Back</button>
          <div className="flex items-center gap-1.5">
            <Gift className="size-3.5 text-amber-600" />
            <span className="text-[10px] font-mono text-amber-600">{loyaltyCustomers.length} members</span>
          </div>
        </div>
        <p className="text-lg font-bold">Loyalty & Rewards</p>

        {/* Program summary */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono text-amber-600">{loyaltyCustomers.length}</p>
            <p className="text-[9px] text-muted-foreground uppercase">Members</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">{totalPoints.toLocaleString()}</p>
            <p className="text-[9px] text-muted-foreground uppercase">Points</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono text-emerald-600">
              {loyaltyCustomers.filter((c) => c.visits > 1).length}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">Repeat</p>
          </div>
        </div>

        {/* Tier breakdown */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold">Tier Program</p>
          <p className="text-[10px] text-muted-foreground">Earn 1 point per KES 10 spent. Points redeemable at checkout.</p>
          <div className="grid grid-cols-4 gap-1.5 mt-2">
            {(["Bronze", "Silver", "Gold", "Platinum"] as const).map((tier) => {
              const count = loyaltyCustomers.filter((c) => c.tier === tier).length;
              const threshold = tier === "Bronze" ? "0" : tier === "Silver" ? "5K" : tier === "Gold" ? "20K" : "50K+";
              return (
                <div key={tier} className="text-center">
                  <p className={`text-xs font-bold rounded-lg py-1 ${TIER_COLORS[tier]}`}>{count}</p>
                  <p className="text-[8px] font-semibold mt-0.5">{tier}</p>
                  <p className="text-[7px] text-muted-foreground">{threshold}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Customer list */}
        <div className="space-y-1 max-h-52 overflow-y-auto">
          {sortedCustomers.length === 0 && (
            <div className="text-center py-6">
              <p className="text-2xl">🎁</p>
              <p className="text-xs text-muted-foreground mt-2">No loyalty members yet</p>
              <p className="text-[10px] text-muted-foreground">Customers auto-enroll on first payment with phone number</p>
            </div>
          )}
          {sortedCustomers.map((c) => (
            <div key={c.phone} className="flex items-center justify-between py-2 px-3 rounded-xl border border-border">
              <div>
                <p className="text-xs font-medium">{c.name}</p>
                <p className="text-[9px] text-muted-foreground">{c.phone} · {c.visits} visits</p>
              </div>
              <div className="text-right">
                <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${TIER_COLORS[c.tier]}`}>{c.tier}</span>
                <p className="text-[9px] font-mono mt-0.5">{c.points.toLocaleString()} pts</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Overview ---
  return (
    <div className="px-5 pt-4 pb-20 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-lg font-bold">Table Service</p>
        <button
          onClick={() => setShowNewTable(!showNewTable)}
          className="size-8 rounded-full bg-foreground text-background flex items-center justify-center"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Active", value: activeTables.length.toString(), color: "text-emerald-600" },
          { label: "Revenue", value: `${(totalRevenue / 1000).toFixed(1)}K`, color: "text-foreground" },
          { label: "Tips", value: `${totalTips.toLocaleString()}`, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-muted p-3 text-center">
            <p className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</p>
            <p className="text-[9px] text-muted-foreground uppercase">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setView("quick-charge")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <Zap className="size-3.5" />
          Quick Charge
        </button>
        <button
          onClick={() => setView("catalogue")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <ClipboardPaste className="size-3.5" />
          Catalogue ({catalogue.length})
        </button>
        <button
          onClick={() => setView("tips-analytics")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <TrendingUp className="size-3.5" />
          Tips Analytics
        </button>
        <button
          onClick={() => setView("payment-history")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <Clock3 className="size-3.5" />
          History
        </button>
      </div>

      {/* Intelligence Layer */}
      <div className="rounded-2xl border-2 border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Brain className="size-3.5 text-purple-600" />
          <p className="text-xs font-semibold text-purple-900 dark:text-purple-200">Intelligence Layer</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setView("ai-forecast")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <TrendingUp className="size-3" />
            Revenue Forecast
          </button>
          <button
            onClick={() => setView("ai-staffing")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <Users className="size-3" />
            Smart Staffing
          </button>
          <button
            onClick={() => setView("ai-insights")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <BarChart3 className="size-3" />
            Customer Insights
          </button>
          <button
            onClick={() => setView("ai-anomalies")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <AlertTriangle className="size-3" />
            Anomaly Detection
          </button>
        </div>
      </div>

      {/* Operations */}
      <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <UtensilsCrossed className="size-3.5 text-amber-600" />
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">Operations</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setView("orders-queue")}
            className="py-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-[10px] font-semibold text-amber-800 dark:text-amber-200 flex flex-col items-center gap-0.5"
          >
            <span className="text-sm">🍳🍺</span>
            Orders
            {orders.filter((o) => o.status === "new").length > 0 && (
              <span className="size-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center font-bold">
                {orders.filter((o) => o.status === "new").length}
              </span>
            )}
          </button>
          <button
            onClick={() => setView("reservations")}
            className="py-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-[10px] font-semibold text-amber-800 dark:text-amber-200 flex flex-col items-center gap-0.5"
          >
            <Calendar className="size-4" />
            Reservations
          </button>
          <button
            onClick={() => setView("loyalty")}
            className="py-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-[10px] font-semibold text-amber-800 dark:text-amber-200 flex flex-col items-center gap-0.5"
          >
            <Gift className="size-4" />
            Loyalty
          </button>
        </div>
      </div>

      {/* Walkout risk alert */}
      {walkoutRiskTables.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 text-red-600" />
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">Walkout risk</p>
          </div>
          <p className="text-[10px] text-red-600 dark:text-red-400">
            {walkoutRiskTables.map((t) => `Table ${t.tableNumber}`).join(", ")} — open 2h+ with no payment
          </p>
        </div>
      )}

      {/* New table form */}
      {showNewTable && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-sm font-semibold">Open new table</p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={newTableNum}
              onChange={(e) => setNewTableNum(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="Table #"
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-sm font-mono outline-none"
            />
            <select
              value={newTableServer}
              onChange={(e) => setNewTableServer(e.target.value)}
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
            >
              {SERVERS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <button
            onClick={createTable}
            disabled={!newTableNum}
            className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-40"
          >
            Open table {newTableNum || "#"}
          </button>
        </div>
      )}

      {/* Active tables */}
      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase text-muted-foreground">
          Active tables ({activeTables.length})
        </p>
        {activeTables.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">No active tables. Tap + to open one.</p>
        )}
        {activeTables.map((t) => {
          const total = getTotal(t);
          const remaining = getRemainingBalance(t);
          const elapsed = Math.round((Date.now() - new Date(t.openedAt).getTime()) / 60000);
          return (
            <button
              key={t.id}
              onClick={() => { setSelectedTable(t); setView("detail"); }}
              className="w-full text-left rounded-xl border border-border p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors"
            >
              <div className={`size-10 rounded-full flex items-center justify-center text-sm font-bold ${
                t.status === "requesting-bill" ? "bg-amber-100 text-amber-700" :
                t.status === "partially-paid" ? "bg-blue-100 text-blue-700" :
                "bg-muted text-foreground"
              }`}>
                {t.tableNumber}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold">Table {t.tableNumber}</p>
                  {t.status === "requesting-bill" && (
                    <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-mono">
                      BILL REQUESTED
                    </span>
                  )}
                  {elapsed > 120 && t.paidAmount === 0 && t.status !== "closed" && (
                    <span className="text-[8px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-mono animate-pulse">
                      ⚠️ WALKOUT
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t.server} · {t.items.length} items · {elapsed}m
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold font-mono">
                  {remaining.toLocaleString()}
                </p>
                {t.paidAmount > 0 && (
                  <p className="text-[9px] text-emerald-600">-{t.paidAmount.toLocaleString()} paid</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
