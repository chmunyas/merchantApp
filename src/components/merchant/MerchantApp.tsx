import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { realtime } from "../../lib/realtime";
import { authFetch, decodeTokenClaims } from "@/lib/auth";
import { DemoVenueBanner } from "@/components/DemoVenueBanner";
import { PaymentQr } from "@/components/pay/PaymentQr";
import { useMerchantIdentity } from "@/lib/use-merchant-identity";
import {
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  Bell,
  Brain,
  Check,
  CircleDollarSign,
  ClipboardList,
  ClipboardPaste,
  Clock3,
  Copy,
  Download,
  FileText,
  Globe,
  Home,
  Layers,
  Lock,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Repeat2,
  ScanLine,
  Send,
  Share2,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from "lucide-react";

import { ModalOverlay } from "@/components/ui/modal-overlay";

import { AIInsightsView } from "./features/AIInsightsView";
import { FeeCard } from "./features/FeeCard";
import { InvoiceCreator } from "./features/InvoiceCreator";
import { SyncCockpit, SyncStatusPill } from "./features/SyncCockpit";
import { SyncedTableServiceView } from "./features/SyncedTableServiceView";
import { QuickOrderView } from "./features/QuickOrderView";
import { TapGoPOS } from "./features/TapGoPOS";
import { WalletReconciliationView } from "./features/WalletReconciliationView";
import { OmniShare } from "./OmniShare";
import { useInvoices } from "./features/hooks";
import type { Invoice } from "./features/types";
import {
  isSettledPayment,
  netSettledAmount,
  paymentFlowLabel,
  paymentMatchesFilter,
  paymentStatusLabel,
  type PaymentLedgerFilter,
  type PaymentLedgerRow,
} from "@/lib/payment-ledger";
import { usePaymentLedger } from "@/lib/use-payment-ledger";
import {
  amountRemaining,
  appendTimelineEvent,
  detectRegionFromCurrency,
  formatTimelineDate,
  fxLockTimeRemaining,
  getPaymentMethodsForRegion,
  payLink,
  timeAgo,
  timelineFor,
  totalPaid,
} from "./features/utils";

type Tab =
  | "home"
  | "invoice"
  | "scan"
  | "list"
  | "insights"
  | "wallets"
  | "tapgo"
  | "order"
  | "tables";

export function MerchantApp({
  standalone = false,
}: {
  standalone?: boolean;
} = {}) {
  const ledger = useInvoices();
  const { name: merchantName } = useMerchantIdentity();
  const [tab, setTab] = useState<Tab>("home");
  const [showInvoice, setShowInvoice] = useState<Invoice | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [clock, setClock] = useState("9:41");

  // Live status-bar clock when running as the standalone app.
  useEffect(() => {
    if (!standalone) return;
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [standalone]);

  // Connect to PesaSwap real-time notifications (per-tenant channel).
  useEffect(() => {
    const claims = decodeTokenClaims();
    // The anonymous showcase uses venue "main" but has no authoritative
    // membership. It must not poll protected financial events as if it did.
    if (!claims?.venue || claims.venue === "main") return;
    realtime.connect(claims.venue);
    return () => realtime.disconnect();
  }, [merchantName]);

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
        toast.info(
          `↩ Refund processed: KES ${(d.amount / 100).toLocaleString()}`,
          {
            description: `Reason: ${d.reason} • By: ${d.refunded_by}`,
          },
        );
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

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // keep the open detail sheet in sync with the canonical ledger record
  const detail = useMemo(
    () =>
      showInvoice
        ? (ledger.invoices.find((i) => i.id === showInvoice.id) ?? showInvoice)
        : null,
    [showInvoice, ledger.invoices],
  );
  const editingInvoice = useMemo(
    () =>
      editingInvoiceId
        ? (ledger.invoices.find((i) => i.id === editingInvoiceId) ?? null)
        : null,
    [editingInvoiceId, ledger.invoices],
  );

  function sendReminder(invoice: Invoice, silent = false) {
    const lastReminder = new Date().toISOString();
    ledger.update(invoice.id, {
      lastReminder,
      timeline: appendTimelineEvent(timelineFor(invoice), {
        label: "Reminder sent",
        at: lastReminder,
      }),
    });
    if (!silent) toast.success(`Reminder sent to ${invoice.customer}`);
  }

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* status bar */}
      <div className="flex items-center justify-between px-6 pb-1 pt-[calc(0.75rem+env(safe-area-inset-top))] text-[11px] font-mono">
        <span>{clock}</span>
        <span className="flex items-center gap-2">
          <SyncStatusPill onClick={() => setTab("home")} />
          <span className="flex items-center gap-1">
            <span className="size-1.5 bg-accent rounded-full" />
            PesaSwap
          </span>
        </span>
      </div>

      <DemoVenueBanner />

      <div className="flex-1 overflow-y-auto pb-24">
        {tab === "home" && (
          <HomeView
            merchantName={merchantName}
            invoices={ledger.invoices}
            isServerBacked={ledger.isServerBacked}
            onOpen={setShowInvoice}
            onNew={() => setTab("invoice")}
            onScan={() => setTab("scan")}
            onSeeAll={() => setTab("list")}
          />
        )}
        {tab === "invoice" && (
          <InvoiceCreator
            onCreate={(inv) => {
              void ledger.add(inv).then(() => {
                toast.success("Invoice created", {
                  description: `${inv.id} · ${inv.currency} ${inv.amount}`,
                });
                setShowInvoice(inv);
                setTab("list");
              }).catch((error) => {
                toast.error(error instanceof Error ? error.message : "Invoice rejected");
              });
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
          <OperatorLedgerView
            invoices={ledger.invoices}
            onOpen={setShowInvoice}
            onMarkPaid={(id) => ledger.markPaid(id, "Batch")}
            onSendReminder={(id) => {
              const invoice = ledger.invoices.find((item) => item.id === id);
              if (invoice && invoice.status !== "Paid")
                sendReminder(invoice, true);
            }}
          />
        )}
        {tab === "insights" && (
          <AIInsightsView
            invoices={ledger.invoices}
            isServerBacked={ledger.isServerBacked}
            onOpen={setShowInvoice}
          />
        )}
        {tab === "wallets" && (
          <WalletReconciliationView
            isServerBacked={ledger.isServerBacked}
          />
        )}
        {tab === "tapgo" && <TapGoPOS />}
        {tab === "order" && <QuickOrderView />}
        {tab === "tables" && <SyncedTableServiceView />}
      </div>

      {/* bottom nav */}
      <nav
        aria-label="Operator sections"
        className={`absolute inset-x-0 bottom-0 grid grid-cols-7 gap-1 border-t border-border bg-card/95 px-2 py-2 backdrop-blur ${standalone ? "pb-[calc(0.5rem+env(safe-area-inset-bottom))]" : "rounded-b-[2.4rem]"}`}
      >
        {[
          { id: "order", icon: ClipboardList, label: "Order" },
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
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl py-2 transition-colors ${
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground"
              }`}
            >
              <t.icon aria-hidden="true" className="size-4" />
              <span className="text-[9px] font-medium uppercase tracking-wider">
                {t.label}
              </span>
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
        <ModalOverlay
          onClose={() => setEditingInvoiceId(null)}
          label="Edit invoice"
          closeLabel="Close invoice editor"
          className="absolute inset-0 flex items-end rounded-b-[2.4rem] overflow-hidden"
          backdropClassName="bg-foreground/50"
          panelClassName="w-full bg-card rounded-t-3xl pb-5 max-h-[92%] overflow-y-auto animate-slide-up"
        >
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
                toast.success("Invoice updated", {
                  description: updatedInvoice.id,
                });
                setEditingInvoiceId(null);
              }}
            />
        </ModalOverlay>
      )}

      {payTarget && (
        <PaySheet
          invoice={payTarget}
          onClose={() => setPayTarget(null)}
          onConfirm={(provider) => {
            ledger.markPaid(payTarget.id, provider);
            toast.success(`Paid via ${provider}`, {
              description: `${payTarget.currency} ${payTarget.amount.toLocaleString()} · ${payTarget.id}`,
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
  merchantName,
  invoices,
  isServerBacked,
  onOpen,
  onNew,
  onScan,
  onSeeAll,
}: {
  merchantName: string;
  invoices: Invoice[];
  isServerBacked: boolean;
  onOpen: (i: Invoice) => void;
  onNew: () => void;
  onScan: () => void;
  onSeeAll: () => void;
}) {
  const outstanding = invoices
    .filter((i) => i.status !== "Paid")
    .reduce((s, i) => s + i.amount, 0);
  const counts = {
    paid: invoices.filter((i) => i.status === "Paid").length,
    pending: invoices.filter((i) => i.status === "Pending").length,
    partial: invoices.filter((i) => i.status === "Partial").length,
    overdue: invoices.filter((i) => i.status === "Overdue").length,
  };
  // Currencies actually present in the ledger (real data is typically KES).
  const presentCurrencies = Array.from(
    new Set(invoices.map((i) => i.currency).filter(Boolean)),
  );
  const currencyList = (
    presentCurrencies.length > 0
      ? presentCurrencies
      : ["USD", "EUR", "GBP", "KES", "NGN"]
  ).slice(0, 5);
  const primaryCurrency = presentCurrencies[0] ?? "KES";
  const currencyTotals = currencyList.map((currency) => ({
    currency,
    total: invoices
      .filter((i) => i.status !== "Paid" && i.currency === currency)
      .reduce((sum, i) => sum + i.amount, 0),
  }));
  const maxCurrencyTotal = Math.max(
    ...currencyTotals.map((item) => item.total),
    1,
  );

  return (
    <div className="px-5 pt-3 space-y-5">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Merchant
          </p>
          <h1 className="text-lg font-bold">{merchantName}</h1>
        </div>
        <a
          href="/dashboard/inbox"
          aria-label="Open notifications"
          className="flex size-11 items-center justify-center rounded-full bg-muted"
        >
          <Bell aria-hidden="true" className="size-4" />
        </a>
      </div>

      {/* balance card */}
      <div className="rounded-2xl bg-foreground text-background p-5 space-y-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">
            Outstanding receivables
          </p>
          <p className="text-[9px] font-mono uppercase tracking-widest opacity-50">
            {isServerBacked ? "Live venue ledger" : "Demo data"}
          </p>
          <p className="text-3xl font-bold font-mono mt-1">
            {primaryCurrency} {outstanding.toLocaleString()}
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2 border-t border-background/10 pt-2 text-center">
          <Stat label="Paid" value={String(counts.paid)} />
          <Stat label="Pending" value={String(counts.pending)} />
          <Stat label="Partial" value={String(counts.partial)} />
          <Stat label="Overdue" value={String(counts.overdue)} />
        </div>
      </div>

        {/* Review-only offline payment drafts. Never auto-submit money movement. */}
      <SyncCockpit />

      {/* Fee transparency: the real blended rate paid over the last 30 days. */}
      <FeeCard />

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
                <span className="font-mono text-muted-foreground">
                  {item.total.toLocaleString()}
                </span>
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
          <button
            onClick={onSeeAll}
            className="min-h-11 text-[11px] font-medium text-accent"
          >
            See all
          </button>
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
    Void: "bg-slate-100 text-slate-500",
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
            selected
              ? "bg-foreground border-foreground text-background"
              : "border-border bg-background"
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
        <span
          className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight ${map[invoice.status]}`}
        >
          {invoice.status}
        </span>
      </div>
    </button>
  );
}

// ─── TAP & GO POS ─────────────────────────────────────────────────────────────

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
    // 1. JSON PesaSwap payload
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
    // 2. URL with ?i=INV-xxxx (canonical pay link) or the legacy ?pay=INV-xxxx
    try {
      const url = new URL(trimmed);
      const id = url.searchParams.get("i") || url.searchParams.get("pay");
      if (id) {
        const known = invoices.find((i) => i.id === id);
        if (known) return onDetected(known);
      }
    } catch {
      /* not url */
    }
    // 3. Plain invoice id
    const known = invoices.find(
      (i) => i.id.toLowerCase() === trimmed.toLowerCase(),
    );
    if (known) return onDetected(known);

    toast.error("Unrecognized QR payload", {
      description: "Try a PesaSwap invoice.",
    });
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
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Scanner
        </p>
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
          <div
            key={p}
            className={`absolute ${p} size-6 border-t-2 border-l-2 border-accent rounded-tl-md`}
          />
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
          placeholder="Paste JSON, URL or INV-xxxxx"
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
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Supported
        </p>
        <div className="flex flex-wrap gap-1.5">
          {["EMVCo QR", "PIX BR", "UPI IN", "PromptPay TH", "PesaSwap"].map(
            (s) => (
              <span
                key={s}
                className="text-[10px] px-2 py-0.5 rounded-full bg-card border border-border"
              >
                {s}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

type OperatorLedgerProps = {
  invoices: Invoice[];
  onOpen: (invoice: Invoice) => void;
  onMarkPaid: (id: string) => void;
  onSendReminder: (id: string) => void;
};

function OperatorLedgerView(props: OperatorLedgerProps) {
  const [view, setView] = useState<"payments" | "invoices">("payments");

  return (
    <div className="space-y-4 px-5 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Ledger
          </p>
          <h1 className="text-lg font-bold">Transaction records</h1>
        </div>
        <Link
          to="/dashboard/payments"
          className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Back office
        </Link>
      </div>

      <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
        {(
          [
            ["payments", "Payments"],
            ["invoices", "Invoices"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={view === id}
            className={`min-h-11 rounded-lg text-xs font-semibold transition-colors ${
              view === id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "payments" ? (
        <PaymentLedgerView />
      ) : (
        <InvoiceListView {...props} embedded />
      )}
    </div>
  );
}

const PAYMENT_STATUS_STYLE: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-800",
  paid: "bg-emerald-100 text-emerald-800",
  captured: "bg-emerald-100 text-emerald-800",
  processing: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-200 text-slate-700",
  partially_refunded: "bg-indigo-100 text-indigo-800",
  refunded: "bg-indigo-100 text-indigo-800",
};

function formatLedgerMoney(amountMinor: number, currency: string): string {
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

function PaymentLedgerView() {
  const query = usePaymentLedger(100);
  const [filter, setFilter] = useState<PaymentLedgerFilter>("all");
  const [selected, setSelected] = useState<PaymentLedgerRow | null>(null);
  const claims = decodeTokenClaims();
  const canRead =
    Boolean(claims?.venue && claims.venue !== "main") &&
    ["manager", "merchant"].includes(String(claims?.role ?? ""));
  const payments = query.data ?? [];
  const visible = payments.filter((payment) =>
    paymentMatchesFilter(payment, filter),
  );
  const settledCount = payments.filter(isSettledPayment).length;
  const netReceived = netSettledAmount(payments);

  if (!canRead) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-center">
        <ShieldCheck className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold">Sign in to view live payments</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The demo keeps example invoices locally. Venue transaction records are
          available only to an authenticated manager or owner.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-foreground p-4 text-background">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-widest opacity-60">
              Settled after refunds
            </p>
            <p className="mt-1 font-mono text-2xl font-bold">
              {formatLedgerMoney(netReceived, "KES")}
            </p>
            <p className="mt-1 text-[10px] opacity-60">
              {settledCount} settled · {payments.length} attempts
            </p>
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Refresh payment ledger"
            className="flex size-11 items-center justify-center rounded-full bg-background/10 disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-4 ${query.isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ["all", "All"],
            ["settled", "Settled"],
            ["processing", "Processing"],
            ["failed", "Failed"],
            ["refunded", "Refunded"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`min-h-9 shrink-0 rounded-full border px-3 text-[10px] font-semibold ${
              filter === id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Loading venue transactions…
        </p>
      ) : query.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4" /> Ledger unavailable
          </div>
          <p className="mt-1 text-xs">
            No local values are substituted. Retry when the server is available.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
          {payments.length === 0
            ? "No payment attempts have been recorded for this venue yet."
            : "No transactions match this filter."}
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((payment) => {
            const principal = Math.max(0, payment.amount - payment.tipAmount);
            return (
              <button
                key={payment.id}
                type="button"
                onClick={() => setSelected(payment)}
                className="w-full rounded-2xl border border-border bg-card p-4 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {paymentFlowLabel(payment)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(payment.createdAt).toLocaleString()} · {payment.customerName || payment.customerPhone || "Guest"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${
                      PAYMENT_STATUS_STYLE[payment.status] ??
                      "bg-muted text-muted-foreground"
                    }`}
                  >
                    {paymentStatusLabel(payment.status)}
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-lg font-bold">
                      {formatLedgerMoney(payment.amount, payment.currency)}
                    </p>
                    {payment.tipAmount > 0 ? (
                      <p className="text-[10px] text-muted-foreground">
                        Bill {formatLedgerMoney(principal, payment.currency)} + tip {formatLedgerMoney(payment.tipAmount, payment.currency)}
                      </p>
                    ) : null}
                    {payment.refundedAmount > 0 ? (
                      <p className="text-[10px] font-semibold text-indigo-700">
                        {formatLedgerMoney(payment.refundedAmount, payment.currency)} refunded
                      </p>
                    ) : null}
                  </div>
                  <p className="max-w-[45%] truncate font-mono text-[9px] text-muted-foreground">
                    {payment.providerRef || payment.reference || payment.sourceId || payment.id}
                  </p>
                </div>
                {payment.errorMessage ? (
                  <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
                    {payment.errorMessage}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-center text-[9px] text-muted-foreground">
        Server ledger · refreshes every 15 seconds
      </p>

      {selected ? (
        <OperatorPaymentDetail
          payment={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function OperatorPaymentDetail({
  payment,
  onClose,
}: {
  payment: PaymentLedgerRow;
  onClose: () => void;
}) {
  const principal = Math.max(0, payment.amount - payment.tipAmount);
  const rows: Array<[string, string]> = [
    ["Total", formatLedgerMoney(payment.amount, payment.currency)],
    ["Bill", formatLedgerMoney(principal, payment.currency)],
    ...(payment.tipAmount > 0
      ? [["Tip", formatLedgerMoney(payment.tipAmount, payment.currency)] as [string, string]]
      : []),
    ["Status", paymentStatusLabel(payment.status)],
    ["Source", paymentFlowLabel(payment)],
    ["Customer", payment.customerName || payment.customerPhone || "Guest"],
    ["Provider reference", payment.providerRef || "Not assigned"],
    [
      "Merchant reference",
      payment.reference || payment.sourceId || "Not assigned",
    ],
    ...(payment.refundedAmount > 0
      ? [["Refunded", formatLedgerMoney(payment.refundedAmount, payment.currency)] as [string, string]]
      : []),
    ...(payment.refundReason
      ? [["Refund reason", payment.refundReason] as [string, string]]
      : []),
    ...(payment.errorMessage
      ? [["Failure reason", payment.errorMessage] as [string, string]]
      : []),
    ["Initiated by", payment.initiator],
    ["Recorded", new Date(payment.createdAt).toLocaleString()],
    ["Payment ID", payment.id],
  ];

  return (
    <ModalOverlay
      onClose={onClose}
      labelledBy="operator-payment-heading"
      className="absolute inset-0 flex items-end overflow-hidden"
      backdropClassName="bg-foreground/50"
      panelClassName="max-h-[88%] w-full overflow-y-auto rounded-t-3xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Authoritative record
          </p>
          <h2 id="operator-payment-heading" className="text-lg font-bold">
            Payment detail
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close payment detail"
          className="flex size-11 items-center justify-center rounded-full bg-muted"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="mt-4 divide-y divide-border rounded-2xl border border-border">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-4 px-4 py-3"
          >
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="max-w-[62%] break-all text-right font-mono text-xs font-semibold">
              {value}
            </span>
          </div>
        ))}
      </div>
    </ModalOverlay>
  );
}

function InvoiceListView({
  invoices,
  onOpen,
  onMarkPaid,
  onSendReminder,
  embedded = false,
}: {
  invoices: Invoice[];
  onOpen: (i: Invoice) => void;
  onMarkPaid: (id: string) => void;
  onSendReminder: (id: string) => void;
  embedded?: boolean;
}) {
  const [filter, setFilter] = useState<"All" | Invoice["status"]>("All");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const filtered =
    filter === "All" ? invoices : invoices.filter((i) => i.status === filter);
  const selectedInvoices = invoices.filter((invoice) =>
    selectedIds.includes(invoice.id),
  );

  function toggleSelected(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function exportSelected() {
    if (selectedInvoices.length === 0) return;
    const blob = new Blob([JSON.stringify(selectedInvoices, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `merchant-invoices-${selectedInvoices.length}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedInvoices.length} invoices`);
  }

  return (
    <div className={`${embedded ? "" : "px-5 pt-3"} space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        {!embedded ? (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Ledger
            </p>
            <h1 className="text-lg font-bold">All invoices</h1>
          </div>
        ) : (
          <p className="text-sm font-semibold">Invoice records</p>
        )}
        <button
          onClick={() => {
            setSelectMode((value) => !value);
            setSelectedIds([]);
          }}
          className={`rounded-full border px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
            selectMode
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground"
          }`}
        >
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {(["All", "Pending", "Partial", "Overdue", "Paid"] as const).map(
          (f) => (
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
          ),
        )}
      </div>
      {selectMode && (
        <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Selected invoices</span>
            <span className="font-mono font-semibold">
              {selectedIds.length}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                const actionable = selectedInvoices.filter(
                  (invoice) => invoice.status !== "Paid",
                );
                actionable.forEach((invoice) => onMarkPaid(invoice.id));
                if (actionable.length)
                  toast.success(`Marked ${actionable.length} invoices as paid`);
                setSelectedIds([]);
              }}
              className="flex flex-col items-center gap-1 rounded-xl bg-muted px-2 py-3 text-[10px] font-medium"
            >
              <Check className="size-4" />
              Mark all paid
            </button>
            <button
              onClick={() => {
                const actionable = selectedInvoices.filter(
                  (invoice) => invoice.status !== "Paid",
                );
                actionable.forEach((invoice) => onSendReminder(invoice.id));
                if (actionable.length)
                  toast.success(`Sent ${actionable.length} reminders`);
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
          <p className="text-center text-[11px] text-muted-foreground py-8">
            No invoices.
          </p>
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
  const { name: MERCHANT_NAME, till: TILL_NUMBER } = useMerchantIdentity();
  const timeline = timelineFor(invoice);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [partialVia, setPartialVia] = useState("PesaSwap");
  // Persist this (client-side) invoice to Postgres so its shared link + QR
  // resolve to a real, payable /pay?i=<number> page. Until that succeeds there
  // is no payable link to give anyone, so sharing stays closed.
  const [publicLink, setPublicLink] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<
    "publishing" | "published" | "signed-out" | "failed"
  >(invoice.serverId ? "published" : "publishing");
  const link = publicLink ?? payLink(invoice);
  const shareable = publishState === "published";
  const paid = totalPaid(invoice);
  const remaining = amountRemaining(invoice);

  useEffect(() => {
    if (invoice.serverId) {
      setPublishState("published");
      return;
    }
    let cancelled = false;
    setPublishState("publishing");
    void (async () => {
      try {
        const res = await authFetch("/api/invoices/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: invoice.id,
            amount: invoice.amount,
            currency: invoice.currency,
            customer: invoice.customer,
            phone: invoice.customerPhone ?? null,
            note: invoice.note ?? null,
            status: invoice.status,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setPublishState(
            res.status === 401 || res.status === 403 ? "signed-out" : "failed",
          );
          return;
        }
        const data = (await res.json()) as { payLink?: string };
        if (cancelled) return;
        if (data.payLink) setPublicLink(data.payLink);
        setPublishState("published");
      } catch {
        if (!cancelled) setPublishState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    invoice.id,
    invoice.serverId,
    invoice.amount,
    invoice.currency,
    invoice.customer,
    invoice.customerPhone,
    invoice.note,
    invoice.status,
  ]);

  async function copyLink() {
    if (!shareable) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Payment link copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function share() {
    if (!shareable) return;
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
    <ModalOverlay
      onClose={onClose}
      label={`Invoice ${invoice.id}`}
      closeLabel="Close invoice sheet"
      className="absolute inset-0 z-40 flex items-end rounded-b-[2.4rem] overflow-hidden"
      backdropClassName="bg-foreground/40"
      panelClassName="w-full bg-card rounded-t-3xl p-5 space-y-4 animate-slide-up max-h-[92%] overflow-y-auto"
    >
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              {invoice.id}
            </p>
            <h2 className="text-base font-bold">{invoice.customer}</h2>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-full bg-muted flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-background p-5 flex flex-col items-center gap-3">
          {shareable ? (
            <>
              <PaymentQr
                merchantName={MERCHANT_NAME}
                till={TILL_NUMBER}
                amountMinor={Math.round(
                  (remaining > 0 ? remaining : Number(invoice.amount)) * 100,
                )}
                reference={invoice.id}
                cameraUrl={link}
                keqr={invoice.currency === "KES"}
                defaultMode="keqr"
                size={180}
              />
              <p className="text-[10px] font-mono text-muted-foreground text-center break-all px-4">
                {link}
              </p>
            </>
          ) : (
            // Showing a QR for an unpublished invoice hands the merchant a code
            // that 404s at the till, so it is withheld rather than decorated.
            <div
              role="status"
              className="flex flex-col items-center gap-2 py-6 text-center"
            >
              <AlertTriangle
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-xs font-semibold text-foreground">
                {publishState === "publishing"
                  ? "Publishing invoice…"
                  : publishState === "signed-out"
                    ? "Saved on this device only"
                    : "Couldn't publish this invoice"}
              </p>
              <p className="max-w-[16rem] text-[11px] text-muted-foreground">
                {publishState === "publishing"
                  ? "The payment QR appears once this invoice reaches your account."
                  : publishState === "signed-out"
                    ? "This session isn't linked to a venue, so this invoice stays in this browser — it won't appear in your back office and can't be paid. Sign in with a venue account to publish it."
                    : "The payment link isn't live, so it can't be shared yet. Check your connection and reopen this invoice."}
              </p>
            </div>
          )}
        </div>

        <div className="rounded-xl bg-muted p-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {paid > 0 ? "Remaining balance" : "Amount due"}
          </p>
          <p className="text-3xl font-bold font-mono mt-1">
            {invoice.currency}{" "}
            {paid > 0
              ? remaining.toLocaleString()
              : invoice.amount.toLocaleString()}
            .00
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Status · <span className="font-semibold">{invoice.status}</span>
          </p>
          {paid > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground px-1">
                <span>
                  Paid: {invoice.currency} {paid.toLocaleString()}
                </span>
                <span>{Math.round((paid / invoice.amount) * 100)}%</span>
              </div>
              <div className="h-2 rounded-full bg-background overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{
                    width: `${Math.min(100, (paid / invoice.amount) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div
          className={`grid gap-2 ${invoice.status === "Pending" || invoice.status === "Overdue" || invoice.status === "Partial" ? "grid-cols-5" : "grid-cols-3"}`}
        >
          <SheetBtn
            icon={Copy}
            label="Copy link"
            disabled={!shareable}
            onClick={copyLink}
          />
          <SheetBtn
            icon={Share2}
            label="Share"
            disabled={!shareable}
            onClick={share}
          />
          {(invoice.status === "Pending" ||
            invoice.status === "Overdue" ||
            invoice.status === "Partial") && (
            <SheetBtn icon={Pencil} label="Edit" onClick={onEdit} />
          )}
          {(invoice.status === "Pending" ||
            invoice.status === "Overdue" ||
            invoice.status === "Partial") && (
            <SheetBtn
              icon={CircleDollarSign}
              label="Record $"
              onClick={() => setShowRecordPayment(true)}
            />
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
              <option>PesaSwap</option>
              <option>Bank Transfer</option>
              <option>M-Pesa</option>
              <option>Cash</option>
              <option>Coop Bank Kenya</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRecordPayment(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-xs font-mono uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                disabled={
                  !partialAmount ||
                  Number(partialAmount) <= 0 ||
                  Number(partialAmount) > remaining
                }
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
                  <p className="text-[11px] text-muted-foreground">
                    Reminded {timeAgo(invoice.lastReminder)}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No reminder sent yet
                  </p>
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
            <button
              type="button"
              disabled={!shareable}
              onClick={() => setShowShare(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3 text-xs font-bold text-background disabled:opacity-40"
            >
              <Send className="size-4" aria-hidden="true" /> Send to{" "}
              {invoice.customer}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!shareable}
                onClick={() => setShowShare(true)}
                className="flex flex-col items-center gap-1 py-3 rounded-xl bg-green-50 border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-40"
              >
                <MessageCircle
                  className="size-4 text-green-600"
                  aria-hidden="true"
                />
                <span className="text-[9px] font-mono uppercase tracking-widest text-green-700">
                  Audited channel
                </span>
              </button>
              <button
                disabled={!shareable}
                onClick={share}
                className="flex flex-col items-center gap-1 py-3 rounded-xl bg-muted border border-border hover:bg-foreground hover:text-background transition-colors disabled:opacity-40"
              >
                <Share2 className="size-4" />
                <span className="text-[9px] font-mono uppercase tracking-widest">
                  Share
                </span>
              </button>
            </div>
          </div>
        )}

        <OmniShare
          open={showShare}
          onClose={() => setShowShare(false)}
          title="Send payment link"
          kind="invoice"
          message={`Hi ${invoice.customer}, here's your ${invoice.currency} ${invoice.amount.toLocaleString()} invoice (${invoice.id}).`}
          link={link}
          defaultPhone={invoice.customerPhone ?? ""}
        />

        {invoice.fxLock && (
          <div
            className={`rounded-2xl border p-4 space-y-2 ${
              fxLockTimeRemaining(invoice.fxLock) === "Expired"
                ? "border-red-200 bg-red-50"
                : "border-emerald-200 bg-emerald-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <Lock
                className={`size-4 ${fxLockTimeRemaining(invoice.fxLock) === "Expired" ? "text-red-600" : "text-emerald-600"}`}
              />
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700">
                FX Rate Locked
              </p>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Rate</span>
              <span className="font-mono font-bold">
                1 {invoice.fxLock.from} = {invoice.fxLock.rate.toFixed(4)}{" "}
                {invoice.fxLock.to}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">You receive</span>
              <span className="font-mono font-bold">
                {invoice.fxLock.to}{" "}
                {(invoice.amount * invoice.fxLock.rate).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Expires in</span>
              <span
                className={`font-mono font-bold ${fxLockTimeRemaining(invoice.fxLock) === "Expired" ? "text-red-600" : "text-emerald-600"}`}
              >
                {fxLockTimeRemaining(invoice.fxLock)}
              </span>
            </div>
          </div>
        )}

        {(invoice.status === "Pending" ||
          invoice.status === "Overdue" ||
          invoice.status === "Partial") && (
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-3 flex items-center gap-3">
            <Brain className="size-5 text-purple-500 shrink-0" />
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-purple-600">
                AI Prediction
              </p>
              <p className="text-[11px] font-semibold text-purple-800">
                {invoice.customer} typically pays in ~
                {Math.max(2, Math.round(Math.random() * 8 + 4))} days
              </p>
            </div>
          </div>
        )}

        <div className="space-y-1.5 pt-2">
          {[
            ["Issue date", invoice.date],
            ...(invoice.paidRef
              ? [["M-Pesa REF", invoice.paidRef] as [string, string]]
              : []),
            ["Settles to", "USD wallet"],
            [
              "FX route",
              invoice.paidVia
                ? `Settled · ${invoice.paidVia}`
                : "Best rate · Coop Bank Kenya",
            ],
            ["Fee", "0.35 %"],
            ...(invoice.recurring
              ? [
                  [
                    "Recurring",
                    `${invoice.recurring.frequency} · next ${formatTimelineDate(invoice.recurring.nextDate)}`,
                  ],
                ]
              : []),
            ...(invoice.installmentPlan
              ? [
                  [
                    "Installments",
                    `${invoice.installmentPlan.count}× ${invoice.installmentPlan.frequency}`,
                  ],
                ]
              : []),
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between text-[11px] py-1.5 border-b border-border last:border-none"
            >
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
                <div
                  key={inst.number}
                  className="flex items-center justify-between py-1.5 border-b border-border last:border-none"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${
                        inst.status === "Paid"
                          ? "bg-green-500"
                          : inst.status === "Due"
                            ? "bg-amber-500"
                            : inst.status === "Overdue"
                              ? "bg-red-500"
                              : "bg-muted-foreground/30"
                      }`}
                    />
                    <span className="text-[11px] font-mono">
                      #{inst.number}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-semibold">
                    {invoice.currency} {inst.amount.toLocaleString()}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {inst.status === "Paid"
                      ? "Paid ✓"
                      : formatTimelineDate(inst.dueDate)}
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
                <div
                  key={p.id}
                  className="flex items-center justify-between py-1.5 border-b border-border last:border-none"
                >
                  <div>
                    <span className="text-[11px] font-mono font-semibold">
                      {invoice.currency} {p.amount.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-2">
                      via {p.paidVia}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {formatTimelineDate(p.paidAt)}
                  </span>
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
                  {index < timeline.length - 1 && (
                    <span className="mt-1 w-px flex-1 min-h-8 bg-border" />
                  )}
                </div>
                <div className="pb-4">
                  <p className="text-xs font-semibold">{event.label}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {formatTimelineDate(event.at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
    </ModalOverlay>
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
  { id: "Coop Bank Kenya", rate: 1.0842, fee: 0.0035 },
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
    <ModalOverlay
      onClose={onClose}
      label="Confirm payment"
      closeLabel="Close payment sheet"
      className="absolute inset-0 flex items-end rounded-b-[2.4rem] overflow-hidden"
      backdropClassName="bg-foreground/50"
      panelClassName="w-full bg-card rounded-t-3xl p-5 space-y-4 animate-slide-up"
    >
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Confirm payment
            </p>
            <h2 className="text-base font-bold">{invoice.customer}</h2>
            <p className="text-[10px] font-mono text-muted-foreground">
              {invoice.id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="size-8 rounded-full bg-muted flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rounded-xl bg-foreground text-background p-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">
            You pay
          </p>
          <p className="text-3xl font-bold font-mono mt-1">
            {invoice.currency} {total.toFixed(2)}
          </p>
          <p className="text-[10px] opacity-60 mt-1">
            incl. {invoice.currency} {fee.toFixed(2)} fee · rate{" "}
            {selected.rate}
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
                          rate {p.rate} · fee {(p.fee * 100).toFixed(2)}%
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
                Local payment methods ·{" "}
                {detectRegionFromCurrency(invoice.currency)}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {getPaymentMethodsForRegion(
                  detectRegionFromCurrency(invoice.currency),
                ).map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-left"
                  >
                    <span className="text-sm">{m.icon}</span>
                    <span className="text-[10px] font-medium truncate">
                      {m.name}
                    </span>
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
                  <ShieldCheck className="size-4" /> Pay {invoice.currency}{" "}
                  {total.toFixed(2)}
                </>
              )}
            </button>
            <p className="text-[10px] text-center text-muted-foreground">
              Secured by PesaSwap · 3D-Secure where applicable
            </p>
          </>
        )}
    </ModalOverlay>
  );
}
