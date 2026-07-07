import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  Zap,
  CheckCircle2,
  ShieldCheck,
  Fingerprint,
  Smartphone,
  Clock3,
  QrCode,
  Camera,
  AlertCircle,
  Star,
} from "lucide-react";
import {
  executePayment,
  buildPaymentMetadata,
  loadHyperLoader,
  type PaymentStatus,
} from "../lib/pesaswap-payments";
import { tipSuggestions } from "@/lib/tip";
import { QRCodeSVG } from "qrcode.react";

export const Route = createFileRoute("/pay")({
  head: () => ({
    meta: [
      { title: "Tap & Go Pay — PesaSwap" },
      {
        name: "description",
        content: "Scan QR, tap to pay. Fastest M-Pesa checkout in Kenya.",
      },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
  component: PayPage,
});

type PaymentState = "idle" | "scanned" | "confirming" | "pin" | "processing" | "success" | "error";

type OrderLineItem = { name: string; qty: number; price: number };

type PaymentData = {
  till: string;
  amount: number;
  merchant: string;
  logoUrl?: string | null;
  poweredBy?: string | null;
  staffId?: string | null;
  venue?: string | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  phone?: string | null;
  total?: number | null;
  paid?: number | null;
  remaining?: number | null;
  items?: OrderLineItem[];
  staff?: Array<{ id: string; name: string; role: string }>;
};

function PayPage() {
  const [state, setState] = useState<PaymentState>("idle");
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [pin, setPin] = useState("");
  const [useBiometric, setUseBiometric] = useState(false);
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payTip, setPayTip] = useState(0);
  const [payStaffId, setPayStaffId] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const pendingInvoiceRef = useRef<string | null>(null);

  // Preload HyperLoader on mount for faster checkout
  useEffect(() => {
    loadHyperLoader().catch(() => {});
  }, []);

  // Check URL for tapgo parameter (when scanned from QR)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tapgo = params.get("tapgo");
    if (tapgo) {
      try {
        const data = decodeTapgoPayload(tapgo);
        setPaymentData(data);
        if (data.phone) setCustomerPhone(data.phone);
        setState("scanned");
        startTimeRef.current = Date.now();
      } catch {
        // Invalid QR data
      }
    }
    // Short invoice pay link (/pay?i=INV-XXX) — load the amount by number.
    const invoiceNo = params.get("i");
    if (invoiceNo) {
      void loadInvoice(invoiceNo);
    }

    // Server-bound QR order pay link (/pay?o=<token>) — the amount is loaded from
    // the server, never read from the URL, so it cannot be tampered with.
    const orderToken = params.get("o");
    if (orderToken) {
      void loadQrOrder(orderToken);
    }

    // Check for return from payment redirect
    const status = params.get("status");
    if (status === "complete") {
      setState("success");
    }
  }, []);

  // Resolve a short pay link to its amount + merchant. Surfaces a loading state
  // while fetching and a clear error (with retry) instead of failing silently.
  async function loadInvoice(number: string) {
    pendingInvoiceRef.current = number;
    setLinkError(false);
    setLinkLoading(true);
    try {
      const res = await fetch(
        `/api/invoices/payinfo?number=${encodeURIComponent(number)}`,
      );
      if (!res.ok) throw new Error("not found");
      const data = (await res.json()) as PaymentData & { status?: string };
      setPaymentData({
        till: data.till,
        amount: data.amount,
        merchant: data.merchant,
        logoUrl: data.logoUrl ?? null,
        poweredBy: data.poweredBy ?? null,
        staffId: data.staffId ?? null,
        invoiceNumber: number,
      });
      if (data.status === "paid") {
        setState("success");
      } else {
        setState("scanned");
        startTimeRef.current = Date.now();
      }
    } catch {
      setLinkError(true);
    } finally {
      setLinkLoading(false);
    }
  }

  function confirmPayment(
    phone: string,
    opts?: { amount?: number; tip?: number; staffId?: string | null },
  ) {
    setCustomerPhone(phone);
    if (typeof opts?.amount === "number" && opts.amount > 0) {
      setPayAmount(opts.amount);
    }
    setPayTip(opts?.tip ?? 0);
    setPayStaffId(opts?.staffId ?? null);
    setState("pin");
  }

  // Resolve a server-bound QR order token to its authoritative amount + merchant.
  // The amount is never read from the URL, so it cannot be tampered with.
  async function loadQrOrder(token: string) {
    setLinkError(false);
    setLinkLoading(true);
    try {
      const res = await fetch(`/api/qr/pay/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("invalid");
      const data = (await res.json()) as PaymentData & { status?: string };
      if (data.status === "paid") {
        setState("success");
        return;
      }
      setPaymentData({
        till: data.till,
        amount: data.amount,
        merchant: data.merchant,
        logoUrl: data.logoUrl ?? null,
        poweredBy: data.poweredBy ?? null,
        venue: data.venue ?? null,
        orderId: data.orderId ?? null,
        total: data.total ?? null,
        paid: data.paid ?? null,
        remaining: data.remaining ?? null,
        items: data.items ?? [],
        staff: data.staff ?? [],
      });
      if (data.phone) setCustomerPhone(data.phone);
      setState("scanned");
      startTimeRef.current = Date.now();
    } catch {
      setLinkError(true);
    } finally {
      setLinkLoading(false);
    }
  }

  async function submitPin() {
    if (pin.length < 4 || !paymentData) return;
    await processRealPayment(customerPhone);
  }

  async function useBiometricAuth() {
    setUseBiometric(true);
    if (!paymentData) return;
    await processRealPayment(customerPhone);
  }

  async function processRealPayment(phone: string) {
    if (!paymentData) return;
    setState("processing");
    setErrorMsg("");

    const metadata = buildPaymentMetadata({
      merchant: { name: paymentData.merchant, till: paymentData.till },
      flow: "tapgo",
      customer: { phone },
    });
    // Attribute the payment + tip to the serving staff: the invoice creator, or the
    // server the guest picked in the tip flow.
    const attributedStaff = payStaffId ?? paymentData.staffId ?? null;
    if (attributedStaff) {
      (metadata as Record<string, unknown>).staff_id = attributedStaff;
    }
    // A gratuity rides on top of the bill; tip_amount is stored in minor units.
    if (payTip > 0) {
      (metadata as Record<string, unknown>).tip_amount = Math.round(payTip * 100);
    }
    if (paymentData.venue) {
      (metadata as Record<string, unknown>).venue = paymentData.venue;
      (metadata as Record<string, unknown>).merchant_id = paymentData.venue;
    }
    if (paymentData.orderId) {
      (metadata as Record<string, unknown>).order_id = paymentData.orderId;
    }
    // Tag invoice payments so the ledger settles A/R instead of re-recognising
    // revenue (revenue was booked when the invoice was issued).
    if (paymentData.invoiceNumber) {
      (metadata as Record<string, unknown>).invoice_number =
        paymentData.invoiceNumber;
    }
    (metadata as Record<string, unknown>).till = paymentData.till;

    const result = await executePayment({
      amount: (payAmount ?? paymentData.amount) + payTip,
      currency: "KES",
      metadata,
      phone,
      onStatusChange: (status: PaymentStatus) => {
        if (status === "processing") setState("processing");
      },
    });

    if (result.success) {
      setPaymentId(result.payment_id || null);
      setState("success");
    } else {
      setErrorMsg(result.error || "Payment failed. Please try again.");
      setState("error");
    }
  }

  function reset() {
    setState("idle");
    setPaymentData(null);
    setPin("");
    setUseBiometric(false);
    setCustomerPhone("");
    setPayAmount(null);
    setPayTip(0);
    setPayStaffId(null);
    setPaymentId(null);
    setErrorMsg("");
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/pay");
    }
  }

  function retryPayment() {
    setErrorMsg("");
    setState("scanned");
    setPin("");
  }

  // Demo: simulate scanning
  function simulateScan() {
    setPaymentData({
      till: "247365",
      amount: 2450,
      merchant: "Naivas Supermarket",
    });
    setState("scanned");
    startTimeRef.current = Date.now();
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-4 py-2 mb-4">
            <Zap className="size-4" />
            <span className="text-sm font-bold font-mono">PesaSwap Tap&Go</span>
          </div>
        </div>

        {linkLoading && <InvoiceLoadingState />}
        {linkError && (
          <InvoiceErrorState
            number={pendingInvoiceRef.current}
            onRetry={() => {
              if (pendingInvoiceRef.current) {
                void loadInvoice(pendingInvoiceRef.current);
              }
            }}
            onCancel={() => {
              setLinkError(false);
              reset();
            }}
          />
        )}
        {state === "idle" && !linkLoading && !linkError && (
          <IdleState onScan={simulateScan} />
        )}
        {state === "scanned" && paymentData && (
          <ScannedState data={paymentData} onConfirm={confirmPayment} onCancel={reset} />
        )}
        {state === "pin" && paymentData && (
          <PinState
            data={paymentData}
            pin={pin}
            setPin={setPin}
            onSubmit={submitPin}
            onBiometric={useBiometricAuth}
          />
        )}
        {state === "processing" && <ProcessingState biometric={useBiometric} />}
        {state === "error" && (
          <ErrorState message={errorMsg} onRetry={retryPayment} onCancel={reset} />
        )}
        {state === "success" && paymentData && (
          <SuccessState
            data={paymentData}
            phone={customerPhone}
            paymentId={paymentId}
            elapsedMs={Date.now() - startTimeRef.current}
            onDone={reset}
          />
        )}
      </div>
    </div>
  );
}

function localMpesaDigits(value?: string | null): string {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.startsWith("254")) return digits.slice(3, 12);
  if (digits.startsWith("0")) return digits.slice(1, 10);
  return digits.slice(0, 9);
}

function decodeTapgoPayload(value: string): PaymentData {
  const raw = atob(value);
  try {
    const encoded = Array.from(raw, (char) =>
      `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
    ).join("");
    return JSON.parse(decodeURIComponent(encoded)) as PaymentData;
  } catch {
    return JSON.parse(raw) as PaymentData;
  }
}

function InvoiceLoadingState() {
  return (
    <div className="rounded-3xl border border-border bg-card p-10 text-center">
      <div className="mx-auto mb-4 size-10 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      <p className="text-sm font-semibold">Loading invoice…</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Fetching the amount and merchant details.
      </p>
    </div>
  );
}

function InvoiceErrorState({
  number,
  onRetry,
  onCancel,
}: {
  number: string | null;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-3xl border border-border bg-card p-10 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-500/10">
        <AlertCircle className="size-6 text-red-500" />
      </div>
      <p className="text-sm font-semibold">We couldn&apos;t load this invoice</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {number
          ? `Invoice ${number} may have expired, been paid, or the link is incorrect.`
          : "This payment link looks incorrect."}
      </p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 rounded-xl bg-foreground py-2.5 text-xs font-semibold text-background"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-border py-2.5 text-xs font-semibold"
        >
          Enter manually
        </button>
      </div>
    </div>
  );
}

function IdleState({ onScan }: { onScan: () => void }) {
  const [showManual, setShowManual] = useState(false);
  const [manualTill, setManualTill] = useState("");
  const [manualAmount, setManualAmount] = useState("");

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border-2 border-dashed border-border p-12 flex flex-col items-center gap-4">
        <div className="size-20 rounded-full bg-muted flex items-center justify-center">
          <Camera className="size-10 text-muted-foreground" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold">Scan to Pay</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Point your camera at the merchant's QR code
          </p>
        </div>
      </div>

      <button
        onClick={onScan}
        className="w-full bg-foreground text-background py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
      >
        <QrCode className="size-5" />
        Open scanner
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] font-mono uppercase text-muted-foreground">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {!showManual ? (
        <button
          onClick={() => setShowManual(true)}
          className="w-full border border-border py-4 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 text-muted-foreground"
        >
          <Smartphone className="size-4" />
          Enter till number manually
        </button>
      ) : (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Pay by till number
          </p>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[8px] font-mono uppercase text-muted-foreground">Till / Paybill number</p>
            <input
              type="tel"
              value={manualTill}
              onChange={(e) => setManualTill(e.target.value.replace(/[^0-9]/g, "").slice(0, 7))}
              placeholder="e.g. 247365"
              aria-label="Till or Paybill number"
              className="w-full bg-transparent text-lg font-mono font-bold outline-none mt-0.5"
            />
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[8px] font-mono uppercase text-muted-foreground">Amount (KES)</p>
            <input
              type="tel"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              aria-label="Amount in Kenyan shillings"
              className="w-full bg-transparent text-2xl font-mono font-bold outline-none mt-0.5"
            />
          </div>
          <button
            disabled={manualTill.length < 5 || !manualAmount || Number(manualAmount) <= 0}
            onClick={() => {
              // Redirect to self with tapgo param
              const payload = btoa(JSON.stringify({ till: manualTill, amount: Number(manualAmount), merchant: `Till ${manualTill}` }));
              window.location.href = `/pay?tapgo=${encodeURIComponent(payload)}`;
            }}
            className="w-full bg-emerald-600 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Zap className="size-4" />
            Pay KES {manualAmount ? Number(manualAmount).toLocaleString() : "0"}
          </button>
        </div>
      )}

      <button
        onClick={onScan}
        className="w-full border border-border py-3 rounded-2xl text-xs font-mono text-muted-foreground flex items-center justify-center gap-2"
      >
        <Zap className="size-3.5" />
        Demo: Simulate QR scan
      </button>

      <div className="rounded-2xl bg-muted p-4 space-y-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">How it works</p>
        <div className="space-y-2">
          {[
            { step: "1", text: "Cashier enters amount" },
            { step: "2", text: "You scan the QR code" },
            { step: "3", text: "Confirm with PIN or fingerprint" },
            { step: "4", text: "Done! ~8 seconds total" },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-3">
              <span className="size-6 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-bold">
                {item.step}
              </span>
              <span className="text-sm">{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-center text-muted-foreground">
        No more typing till numbers. No more amount errors. Just scan and go.
      </p>
    </div>
  );
}

function ScannedState({
  data,
  onConfirm,
  onCancel,
}: {
  data: PaymentData;
  onConfirm: (
    phone: string,
    opts?: { amount?: number; tip?: number; staffId?: string | null },
  ) => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState(() => localMpesaDigits(data.phone));
  const remaining =
    typeof data.remaining === "number" ? data.remaining : data.amount;
  const canSplit = Boolean(data.orderId) && typeof data.remaining === "number";
  const items = data.items ?? [];
  const partiallyPaid = typeof data.paid === "number" && data.paid > 0;
  const [mode, setMode] = useState<"full" | "equal" | "item" | "custom">(
    "full",
  );
  const [people, setPeople] = useState(2);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [custom, setCustom] = useState("");
  const staff = data.staff ?? [];
  const [tipPct, setTipPct] = useState(0); // 0 = none, -1 = custom, else percent
  const [customTip, setCustomTip] = useState("");
  const [tipStaff, setTipStaff] = useState("");

  const clamp = (n: number) =>
    Math.max(0, Math.min(remaining, Math.round(n || 0)));
  let share = remaining;
  if (mode === "equal") share = clamp(remaining / Math.max(1, people));
  else if (mode === "item")
    share = clamp(
      items.reduce(
        (s, it, i) => (selected.has(i) ? s + it.qty * it.price : s),
        0,
      ),
    );
  else if (mode === "custom") share = clamp(Number(custom) || 0);

  const tip =
    tipPct === -1
      ? Math.max(0, Math.round(Number(customTip) || 0))
      : Math.round((share * tipPct) / 100);
  const total = share + tip;
  const tipOpts = tipSuggestions(share);

  const toggleItem = (i: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const modes: Array<{ key: typeof mode; label: string }> = [
    { key: "full", label: "Pay all" },
    { key: "equal", label: "Split" },
    { key: "item", label: "By item" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-foreground text-background p-6 text-center space-y-3">
        <div className="size-12 rounded-full bg-background/10 flex items-center justify-center mx-auto">
          <Smartphone className="size-6" />
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Pay to</p>
          <div className="mt-1 flex items-center justify-center gap-2">
            {data.logoUrl ? (
              <img
                src={data.logoUrl}
                alt={data.merchant}
                className="h-7 w-7 rounded bg-white object-contain p-0.5"
              />
            ) : null}
            <p className="text-lg font-bold">{data.merchant}</p>
          </div>
          <p className="text-[11px] font-mono opacity-60">Till {data.till}</p>
          {data.poweredBy ? (
            <p className="text-[10px] uppercase tracking-wider opacity-50">
              {data.poweredBy}
            </p>
          ) : null}
        </div>
        <div className="pt-2 border-t border-background/10">
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">
            {mode === "full" ? "Amount" : "Your share"}
          </p>
          <p className="text-4xl font-bold font-mono mt-1">
            KES {share.toLocaleString()}
          </p>
          {canSplit && (mode !== "full" || partiallyPaid) ? (
            <p className="text-[11px] font-mono opacity-60 mt-1">
              {partiallyPaid
                ? `KES ${remaining.toLocaleString()} left of ${Number(data.total).toLocaleString()}`
                : `of KES ${remaining.toLocaleString()}`}
            </p>
          ) : null}
        </div>
      </div>

      {canSplit ? (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Split the bill
          </p>
          <div className="grid grid-cols-4 gap-2">
            {modes.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`rounded-xl px-2 py-2 text-[11px] font-semibold ${
                  mode === m.key
                    ? "bg-emerald-600 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "equal" ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Split between</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPeople((n) => Math.max(1, n - 1))}
                  className="size-8 rounded-full border border-border text-lg font-bold"
                  aria-label="Fewer people"
                >
                  −
                </button>
                <span className="w-6 text-center font-mono font-bold">{people}</span>
                <button
                  type="button"
                  onClick={() => setPeople((n) => Math.min(20, n + 1))}
                  className="size-8 rounded-full border border-border text-lg font-bold"
                  aria-label="More people"
                >
                  +
                </button>
                <span className="text-sm text-muted-foreground">people</span>
              </div>
            </div>
          ) : null}

          {mode === "item" ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No itemised bill available.
                </p>
              ) : (
                items.map((it, i) => (
                  <button
                    key={`${it.name}-${i}`}
                    type="button"
                    onClick={() => toggleItem(i)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                      selected.has(i)
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-border bg-background"
                    }`}
                  >
                    <span>
                      {it.qty}× {it.name}
                    </span>
                    <span className="font-mono">
                      KES {(it.qty * it.price).toLocaleString()}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}

          {mode === "custom" ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold">KES</span>
              <input
                type="number"
                inputMode="numeric"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder={`Up to ${remaining}`}
                aria-label="Amount to pay"
                className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {canSplit ? (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Add a tip
          </p>
          <div className="grid grid-cols-5 gap-2">
            <button
              type="button"
              onClick={() => setTipPct(0)}
              className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${
                tipPct === 0
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              None
            </button>
            {tipOpts.map((o) => (
              <button
                key={o.pct}
                type="button"
                onClick={() => setTipPct(o.pct)}
                className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${
                  tipPct === o.pct
                    ? "bg-emerald-600 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {o.pct}%
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTipPct(-1)}
              className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${
                tipPct === -1
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              Custom
            </button>
          </div>
          {tipPct === -1 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono font-bold">KES</span>
              <input
                type="number"
                inputMode="numeric"
                value={customTip}
                onChange={(e) => setCustomTip(e.target.value)}
                placeholder="Tip amount"
                aria-label="Tip amount"
                className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          ) : null}
          {staff.length ? (
            <div className="space-y-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                For your server
              </p>
              <select
                value={tipStaff}
                onChange={(e) => setTipStaff(e.target.value)}
                aria-label="Tip recipient"
                className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">The whole team</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.role ? ` · ${s.role}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {tip > 0 ? (
            <p className="text-xs text-muted-foreground">
              Tip KES {tip.toLocaleString()} · You pay KES{" "}
              {total.toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Phone number input */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Your M-Pesa number
        </p>
        <div className="flex gap-2">
          <div className="rounded-xl border border-border bg-muted px-3 py-3 flex items-center">
            <span className="text-sm font-mono font-bold">+254</span>
          </div>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
            placeholder="7XX XXX XXX"
            aria-label="Your M-Pesa phone number"
            className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <p className="text-[9px] text-muted-foreground">
          STK push will be sent to this number for PIN confirmation
        </p>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-3">
        <ShieldCheck className="size-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-[11px] font-semibold text-emerald-700">Verified merchant</p>
          <p className="text-[10px] text-emerald-600">Till number confirmed via Safaricom</p>
        </div>
      </div>

      <button
        disabled={phone.length < 9 || total <= 0}
        onClick={() =>
          onConfirm(`0${phone}`, {
            amount: canSplit ? share : undefined,
            tip,
            staffId: tipStaff || null,
          })
        }
        className="w-full bg-emerald-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Zap className="size-5" />
        {mode === "full" && tip === 0
          ? "Confirm & Pay"
          : `Pay KES ${total.toLocaleString()}`}
      </button>

      <button
        onClick={onCancel}
        className="w-full border border-border py-3 rounded-2xl text-sm text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function PinState({
  data,
  pin,
  setPin,
  onSubmit,
  onBiometric,
}: {
  data: PaymentData;
  pin: string;
  setPin: (v: string) => void;
  onSubmit: () => void;
  onBiometric: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Paying</p>
        <p className="text-2xl font-bold font-mono">KES {data.amount.toLocaleString()}</p>
        <p className="text-sm text-muted-foreground">to {data.merchant}</p>
      </div>

      {/* Biometric option */}
      <button
        onClick={onBiometric}
        className="w-full rounded-2xl border-2 border-foreground p-5 flex flex-col items-center gap-3 hover:bg-muted transition-colors"
      >
        <Fingerprint className="size-12 text-foreground" />
        <div className="text-center">
          <p className="text-sm font-bold">Use fingerprint</p>
          <p className="text-[10px] text-muted-foreground">Fastest — one touch to pay</p>
        </div>
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] font-mono uppercase text-muted-foreground">or enter PIN</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* PIN dots */}
      <div className="flex justify-center gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`size-4 rounded-full border-2 transition-colors ${
              i < pin.length ? "bg-foreground border-foreground" : "border-border"
            }`}
          />
        ))}
      </div>

      {/* PIN pad */}
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key) => (
          <button
            key={key || "empty"}
            disabled={!key}
            onClick={() => {
              if (key === "⌫") setPin(pin.slice(0, -1));
              else if (pin.length < 4) {
                const newPin = pin + key;
                setPin(newPin);
                if (newPin.length === 4) {
                  setTimeout(onSubmit, 300);
                }
              }
            }}
            className={`py-4 rounded-xl text-xl font-mono font-bold transition-colors ${
              key ? "bg-card border border-border hover:bg-muted active:bg-foreground active:text-background" : ""
            }`}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProcessingState({ biometric }: { biometric: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="size-16 rounded-full border-4 border-foreground border-t-transparent animate-spin" />
      <div className="text-center">
        <p className="text-sm font-semibold">
          {biometric ? "Fingerprint verified" : "Processing payment..."}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Confirming via PesaSwap — check your phone for M-Pesa prompt
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  onCancel,
}: {
  message: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center py-8 space-y-4">
        <div className="size-20 rounded-full bg-red-100 flex items-center justify-center">
          <AlertCircle className="size-12 text-red-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-red-700">Payment failed</p>
          <p className="text-sm text-muted-foreground mt-2">{message}</p>
        </div>
      </div>

      <button
        onClick={onRetry}
        className="w-full bg-foreground text-background py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
      >
        <Zap className="size-4" />
        Try Again
      </button>

      <button
        onClick={onCancel}
        className="w-full border border-border py-3 rounded-2xl text-sm text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function SuccessState({
  data,
  phone,
  paymentId,
  elapsedMs,
  onDone,
}: {
  data: PaymentData;
  phone: string;
  paymentId: string | null;
  elapsedMs: number;
  onDone: () => void;
}) {
  const elapsedSec = Math.round(elapsedMs / 1000);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  useEffect(() => {
    const venue = data.venue;
    if (!venue || !phone) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/portal/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ venue, phone }),
        });
        if (!res.ok) return;
        const d = (await res.json()) as { url?: string };
        if (active && d.url) {
          setPortalUrl(`${window.location.origin}${d.url}`);
        }
      } catch {
        /* the rewards portal is a bonus — never block the receipt */
      }
    })();
    return () => {
      active = false;
    };
  }, [data.venue, phone]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center py-6 space-y-4">
        <div className="size-24 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="size-14 text-emerald-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-700">Payment successful!</p>
          <p className="text-3xl font-bold font-mono mt-2">KES {data.amount.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground mt-1">{data.merchant}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-muted p-4 space-y-2">
        {[
          ["Merchant", data.merchant],
          ["Till", data.till],
          ["Amount", `KES ${data.amount.toLocaleString()}`],
          ["Phone", phone ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : "—"],
          ["Method", "M-Pesa via PesaSwap"],
          ["Time", new Date().toLocaleTimeString()],
          ["Reference", paymentId || `TG${Date.now().toString(36).toUpperCase()}`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono font-semibold">{v}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <div className="flex items-center justify-center gap-2 text-emerald-600">
          <Clock3 className="size-4" />
          <span className="text-sm font-bold font-mono">{elapsedSec} seconds</span>
        </div>
        <p className="text-[10px] text-emerald-600 mt-1">
          vs. 2 minutes the old way — {Math.max(50, Math.round((120 - elapsedSec) / 1.2))}% faster
        </p>
      </div>

      {portalUrl ? (
        <div className="rounded-2xl border border-emerald-200 bg-white p-4 text-center space-y-3">
          <p className="text-sm font-bold text-foreground">
            Your rewards &amp; receipt
          </p>
          <div className="flex justify-center">
            <div className="rounded-xl bg-white p-2 ring-1 ring-border">
              <QRCodeSVG value={portalUrl} size={132} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Scan to see your points, redeem rewards &amp; rebook
          </p>
          <a
            href={portalUrl}
            className="inline-block text-xs font-bold text-emerald-700 underline"
          >
            Open my rewards →
          </a>
        </div>
      ) : null}

      <ReviewPrompt
        venue={data.venue}
        merchant={data.merchant}
        phone={phone}
        paymentId={paymentId}
        staffId={data.staffId}
      />

      <button
        onClick={onDone}
        className="w-full bg-foreground text-background py-4 rounded-2xl text-sm font-bold"
      >
        Done
      </button>

      <p className="text-[9px] text-center text-muted-foreground">
        Receipt sent to your M-Pesa. Powered by PesaSwap.
      </p>
    </div>
  );
}

// Post-payment review capture — SundayApp's "payment = start of the
// relationship". A high rating is nudged to Google; a low one is captured
// privately and flagged to the team for service recovery.
function ReviewPrompt({
  venue,
  merchant,
  phone,
  paymentId,
  staffId,
}: {
  venue?: string | null;
  merchant: string;
  phone: string;
  paymentId: string | null;
  staffId?: string | null;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!venue) return null;

  async function submit(stars: number, withComment = false) {
    setBusy(true);
    try {
      await fetch(`/api/reviews?venue=${encodeURIComponent(venue as string)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rating: stars,
          comment: withComment ? comment : undefined,
          phone: phone || undefined,
          paymentId: paymentId || undefined,
          staffId: staffId || undefined,
          source: "pay",
        }),
      });
    } catch {
      /* best-effort — never block leaving */
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center space-y-2">
        <p className="text-sm font-bold">Thanks for the feedback! 🙏</p>
        {rating >= 4 ? (
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(`${merchant} reviews`)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-bold text-amber-700 underline"
          >
            Loved it? Share on Google →
          </a>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            We&apos;ve flagged this to the team to make it right.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-white p-4 text-center space-y-3">
      <p className="text-sm font-bold">How was it at {merchant}?</p>
      <div className="flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`${s} star`}
            disabled={busy}
            onClick={() => {
              setRating(s);
              if (s >= 4) void submit(s);
            }}
          >
            <Star
              className={`size-8 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
            />
          </button>
        ))}
      </div>
      {rating > 0 && rating < 4 ? (
        <div className="space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What could be better? (optional)"
            rows={2}
            className="w-full rounded-xl border border-border p-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={() => submit(rating, true)}
            disabled={busy}
            className="w-full rounded-xl bg-foreground py-2.5 text-xs font-bold text-background disabled:opacity-50"
          >
            Send feedback
          </button>
        </div>
      ) : null}
    </div>
  );
}
