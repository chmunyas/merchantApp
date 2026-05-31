import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  QrCode,
  FileText,
  Zap,
  Smartphone,
  Check,
  Clock,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Download,
  Wifi,
  WifiOff,
  Share2,
  Copy,
  Bell,
  ChevronRight,
  Filter,
  ScanLine,
  Sparkles,
  CheckCircle2,
  Send,
} from "lucide-react";

type WizardStep = "details" | "share" | "confirm";
const CURRENCIES = ["USD", "EUR", "GBP", "NGN"] as const;
type Currency = (typeof CURRENCIES)[number];
const CCY_SYMBOL: Record<Currency, string> = { USD: "$", EUR: "â¬", GBP: "Â£", NGN: "â¦" };

/* ============================================================
   1. QR INVOICING FLOW â Revolut-style focused single-task screen
   ============================================================ */
export function QRInvoicingFlow() {
  const [step, setStep] = useState<WizardStep>("details");
  const [amount, setAmount] = useState("1240");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [customer, setCustomer] = useState("Lumio Studios");
  const [reference, setReference] = useState("Design retainer Â· June");
  const [invoiceId, setInvoiceId] = useState("INV-10247");
  const [submitted, setSubmitted] = useState(false);

  const link = useMemo(
    () => `https://pay.fxengine.app/i/${invoiceId.toLowerCase()}`,
    [invoiceId],
  );
  const payload = useMemo(
    () =>
      JSON.stringify({
        type: "fx-engine/invoice",
        id: invoiceId,
        amount: Number(amount) || 0,
        currency,
        customer,
        reference,
        link,
      }),
    [invoiceId, amount, currency, customer, reference, link],
  );

  const canContinue = Number(amount) > 0 && customer.trim().length > 0;

  const resetAndNew = () => {
    setInvoiceId(`INV-${10248 + Math.floor(Math.random() * 900)}`);
    setAmount("");
    setReference("");
    setSubmitted(false);
    setStep("details");
  };

  const goShare = () => {
    if (!canContinue) {
      toast.error("Add an amount and customer to continue");
      return;
    }
    setStep("share");
  };

  const confirmSubmission = () => {
    setSubmitted(true);
    toast.success(`${invoiceId} sent to ${customer}`, {
      description: `${CCY_SYMBOL[currency]}${Number(amount).toLocaleString()} Â· QR & link delivered`,
    });
  };

  return (
    <FlowShell title="QR invoicing" subtitle="Guided Â· 3 steps">
      <StepIndicator step={step} />

      {step === "details" && (
        <div className="px-5 pt-3 space-y-3 animate-in fade-in">
          <Field label="Amount due">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono">{CCY_SYMBOL[currency]}</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                inputMode="decimal"
                className="flex-1 bg-transparent text-4xl font-bold font-mono outline-none w-0"
              />
            </div>
            <div className="flex gap-1.5 mt-3">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold transition-colors ${
                    currency === c
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Customer">
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Company or person"
              className="w-full bg-transparent text-sm font-semibold outline-none"
            />
          </Field>

          <Field label="Reference (optional)">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="What is this for?"
              className="w-full bg-transparent text-sm outline-none"
            />
          </Field>

          <button
            onClick={goShare}
            disabled={!canContinue}
            className="w-full bg-foreground text-background py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <QrCode className="size-4" /> Generate QR & link
          </button>
        </div>
      )}

      {step === "share" && (
        <div className="px-5 pt-3 space-y-3 animate-in fade-in">
          <div className="rounded-2xl bg-foreground text-background p-5 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest opacity-60">
                  Invoice
                </p>
                <p className="text-sm font-bold font-mono">{invoiceId}</p>
              </div>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-background/10">
                LIVE
              </span>
            </div>
            <div className="bg-background rounded-xl p-4 flex justify-center">
              <QRCodeSVG value={payload} size={160} level="M" />
            </div>
            <div className="text-center">
              <p className="text-[9px] font-mono uppercase tracking-widest opacity-60">
                {customer}
              </p>
              <p className="text-2xl font-bold font-mono mt-0.5">
                {CCY_SYMBOL[currency]}
                {Number(amount).toLocaleString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(link).catch(() => {});
                  toast.success("Payment link copied");
                }}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-background/10 text-[11px] font-semibold"
              >
                <Copy className="size-3.5" /> Copy link
              </button>
              <button
                onClick={() => toast.success("Share sheet opened")}
                className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-background/10 text-[11px] font-semibold"
              >
                <Share2 className="size-3.5" /> Share
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-muted px-3 py-2 text-[10px] font-mono text-muted-foreground truncate">
            {link}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep("details")}
              className="px-3 py-3 rounded-xl border border-border text-xs font-semibold flex items-center gap-1.5"
            >
              <ArrowLeft className="size-3.5" /> Edit
            </button>
            <button
              onClick={() => setStep("confirm")}
              className="flex-1 bg-foreground text-background py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              Review & submit <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="px-5 pt-3 space-y-3 animate-in fade-in">
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div
                className={`size-9 rounded-full flex items-center justify-center ${
                  submitted ? "bg-emerald-50 text-emerald-700" : "bg-muted text-foreground"
                }`}
              >
                {submitted ? <CheckCircle2 className="size-5" /> : <Send className="size-4" />}
              </div>
              <div>
                <p className="text-xs font-semibold">
                  {submitted ? "Invoice submitted" : "Ready to submit"}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {submitted ? "QR active Â· awaiting payment" : "Confirm details below"}
                </p>
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2 text-[11px] font-mono">
              <Row k="Invoice" v={invoiceId} />
              <Row k="Customer" v={customer} />
              <Row
                k="Amount"
                v={`${currency} ${Number(amount).toLocaleString()}`}
                bold
              />
              {reference && <Row k="Reference" v={reference} />}
              <Row k="Channel" v="QR + Payment link" />
            </div>
          </div>

          {!submitted ? (
            <div className="flex gap-2">
              <button
                onClick={() => setStep("share")}
                className="px-3 py-3 rounded-xl border border-border text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowLeft className="size-3.5" /> Back
              </button>
              <button
                onClick={confirmSubmission}
                className="flex-1 bg-foreground text-background py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Check className="size-4" /> Confirm submission
              </button>
            </div>
          ) : (
            <button
              onClick={resetAndNew}
              className="w-full border border-border py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
            >
              <QrCode className="size-4" /> Create another invoice
            </button>
          )}
        </div>
      )}
    </FlowShell>
  );
}

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: { id: WizardStep; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "share", label: "QR & link" },
    { id: "confirm", label: "Confirm" },
  ];
  const activeIdx = steps.findIndex((s) => s.id === step);
  return (
    <div className="px-5 pt-2 flex items-center gap-1.5">
      {steps.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={s.id} className="flex-1 flex items-center gap-1.5">
            <div
              className={`size-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono ${
                active
                  ? "bg-foreground text-background"
                  : done
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </div>
            <span
              className={`text-[10px] font-mono uppercase tracking-widest ${
                active ? "text-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px bg-border" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className={`text-right truncate ${bold ? "font-bold text-sm" : "font-semibold"}`}>
        {v}
      </span>
    </div>
  );
}

/* ============================================================
   2. INVOICE LEDGER FLOW â Wise-style segmented list
   ============================================================ */
export function InvoiceLedgerFlow() {
  const [filter, setFilter] = useState<"All" | "Paid" | "Pending" | "Overdue">("All");
  const rows: { id: string; who: string; amt: number; ccy: string; st: "Paid" | "Pending" | "Overdue"; date: string }[] = [
    { id: "INV-10247", who: "Lumio Studios", amt: 1240, ccy: "USD", st: "Paid", date: "Today, 09:12" },
    { id: "INV-10246", who: "Northwind GmbH", amt: 4820, ccy: "EUR", st: "Pending", date: "Today, 08:04" },
    { id: "INV-10244", who: "Brava Holdings", amt: 3100, ccy: "USD", st: "Paid", date: "Yesterday" },
    { id: "INV-10242", who: "Acme Trading", amt: 920, ccy: "GBP", st: "Overdue", date: "3d ago" },
    { id: "INV-10240", who: "Kano Imports", amt: 580000, ccy: "NGN", st: "Paid", date: "5d ago" },
  ];

  const filtered = filter === "All" ? rows : rows.filter((r) => r.st === filter);
  const total = filtered.reduce((s, r) => s + (r.st === "Paid" ? r.amt : 0), 0);

  return (
    <FlowShell title="Invoice ledger" subtitle="Every payment, organised.">
      <div className="px-5 pt-3 space-y-4">
        <div className="rounded-2xl bg-muted p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            Collected this week
          </p>
          <p className="text-2xl font-bold font-mono mt-0.5">
            ${total.toLocaleString()}
          </p>
          <div className="flex gap-3 mt-3 text-[10px] font-mono">
            <span className="flex items-center gap-1"><Check className="size-3 text-emerald-600" /> 3 paid</span>
            <span className="flex items-center gap-1"><Clock className="size-3 text-amber-600" /> 1 pending</span>
            <span className="flex items-center gap-1"><AlertCircle className="size-3 text-red-600" /> 1 overdue</span>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
          {(["All", "Paid", "Pending", "Overdue"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-colors ${
                filter === f ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
              }`}
            >
              {f}
            </button>
          ))}
          <button className="ml-auto size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
            <Filter className="size-3" />
          </button>
        </div>

        <div className="space-y-2">
          {filtered.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border"
            >
              <div
                className={`size-9 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  r.st === "Paid"
                    ? "bg-emerald-50 text-emerald-700"
                    : r.st === "Pending"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {r.who.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{r.who}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{r.id} Â· {r.date}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold font-mono">
                  {r.ccy} {r.amt.toLocaleString()}
                </p>
                <p className={`text-[9px] font-bold uppercase tracking-tight ${
                  r.st === "Paid" ? "text-emerald-700" : r.st === "Pending" ? "text-amber-700" : "text-red-700"
                }`}>{r.st}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </FlowShell>
  );
}

/* ============================================================
   3. SMART SETTLEMENT FLOW â provider routing, Wise-like clarity
   ============================================================ */
export function SmartSettlementFlow() {
  const providers = [
    { name: "Wise", rate: 1.0842, fee: 4.8, eta: "2 min", best: true },
    { name: "Currencycloud", rate: 1.0836, fee: 6.2, eta: "8 min", best: false },
    { name: "LMAX", rate: 1.0828, fee: 9.4, eta: "12 min", best: false },
    { name: "Verto", rate: 1.0821, fee: 11.0, eta: "20 min", best: false },
  ];

  return (
    <FlowShell title="Smart settlement" subtitle="Best rate, every time.">
      <div className="px-5 pt-3 space-y-4">
        <div className="rounded-2xl bg-foreground text-background p-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest opacity-60">You receive</p>
              <p className="text-2xl font-bold font-mono mt-0.5">EUR 4,820.00</p>
            </div>
            <ArrowRight className="size-5 opacity-60" />
            <div className="text-right">
              <p className="text-[9px] font-mono uppercase tracking-widest opacity-60">Settle as</p>
              <p className="text-2xl font-bold font-mono mt-0.5">USD</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-background/10 flex justify-between text-[10px] font-mono">
            <span className="opacity-60">Live mid-market</span>
            <span className="font-semibold flex items-center gap-1">
              <span className="size-1.5 bg-emerald-400 rounded-full animate-pulse" /> 1.0845
            </span>
          </div>
        </div>

        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-1">
          Routing engine Â· 4 providers
        </p>

        <div className="space-y-2">
          {providers.map((p) => {
            const out = (4820 * p.rate - p.fee).toFixed(2);
            return (
              <div
                key={p.name}
                className={`p-3 rounded-xl border ${
                  p.best ? "border-foreground bg-card" : "border-border bg-card"
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{p.name}</span>
                    {p.best && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-foreground text-background flex items-center gap-1">
                        <Sparkles className="size-2.5" /> BEST
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold font-mono">${out}</span>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
                  <span>{p.rate.toFixed(4)} Â· fee ${p.fee}</span>
                  <span>~{p.eta}</span>
                </div>
              </div>
            );
          })}
        </div>

        <button className="w-full bg-foreground text-background py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
          <Zap className="size-4" /> Settle via Wise
        </button>
      </div>
    </FlowShell>
  );
}

/* ============================================================
   4. PWA FLOW â install, offline, push, scanner
   ============================================================ */
export function PWAFlow() {
  const [online, setOnline] = useState(true);
  return (
    <FlowShell title="PWA & Mobile" subtitle="Works everywhere, even offline.">
      <div className="px-5 pt-3 space-y-4">
        <div className="rounded-2xl bg-gradient-to-br from-foreground to-foreground/80 text-background p-5">
          <div className="flex items-center gap-2">
            <Smartphone className="size-4" />
            <p className="text-[10px] font-mono uppercase tracking-widest opacity-70">
              Install FX Engine
            </p>
          </div>
          <p className="text-lg font-bold mt-2 leading-snug">
            Add to home screen for one-tap payments.
          </p>
          <button className="mt-4 w-full bg-background text-foreground py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2">
            <Download className="size-3.5" /> Install app
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Capability
            icon={online ? Wifi : WifiOff}
            label="Network"
            value={online ? "Online" : "Offline"}
            tone={online ? "ok" : "warn"}
            onClick={() => setOnline((v) => !v)}
          />
          <Capability icon={Bell} label="Push alerts" value="Enabled" tone="ok" />
          <Capability icon={ScanLine} label="QR scanner" value="Camera ready" tone="ok" />
          <Capability icon={Sparkles} label="Biometrics" value="Face ID" tone="ok" />
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Offline drafts Â· synced when online
          </p>
          {[
            { id: "DRAFT-014", who: "Sade's Atelier", amt: "USD 320" },
            { id: "DRAFT-013", who: "Mara Co.", amt: "EUR 95" },
          ].map((d) => (
            <div key={d.id} className="flex items-center gap-3">
              <div className="size-8 rounded-full bg-muted flex items-center justify-center">
                <FileText className="size-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{d.who}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{d.id}</p>
              </div>
              <span className="text-xs font-bold font-mono">{d.amt}</span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-border text-[10px] font-mono">
            <span className="text-muted-foreground">Last sync</span>
            <span className="font-semibold">{online ? "just now" : "pending..."}</span>
          </div>
        </div>
      </div>
    </FlowShell>
  );
}

/* ============================================================
   Shared phone-screen shell
   ============================================================ */
function FlowShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex justify-between items-center px-6 pt-3 pb-1 text-[11px] font-mono">
        <span>9:41</span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 bg-accent rounded-full" /> FXÂ·Live
        </span>
      </div>
      <div className="px-5 pt-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {title}
        </p>
        <h2 className="text-lg font-bold">{subtitle}</h2>
      </div>
      <div className="flex-1 overflow-y-auto pb-8">{children}</div>
    </div>
  );
}

function Capability({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: typeof Bell;
  label: string;
  value: string;
  tone: "ok" | "warn";
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="p-3 rounded-xl border border-border bg-card text-left flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5" />
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={`size-1.5 rounded-full ${tone === "ok" ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        <span className="text-xs font-semibold font-mono">{value}</span>
      </div>
    </button>
  );
}

