import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  Zap,
  CheckCircle2,
  ShieldCheck,
  Smartphone,
  Clock3,
  QrCode,
  Camera,
  AlertCircle,
  Star,
  Pencil,
} from "lucide-react";
import {
  executePayment,
  buildPaymentMetadata,
  loadHyperLoader,
  type PaymentStatus,
} from "../lib/pesaswap-payments";
import { tipTierNotice, tipTiersFor } from "@/lib/tip-tiers";
import { noteBestEffortFailure } from "@/lib/best-effort";
import { loyaltyPointsFor } from "@/lib/loyalty";
import { useBranding } from "@/lib/branding";
import { QrScanner } from "@/components/QrScanner";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  DEFAULT_CURRENCY,
  normalizeCurrency,
  toMinorUnits,
} from "@/lib/currency";

export const Route = createFileRoute("/pay")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { o?: string; i?: string; r?: string; tapgo?: string; status?: string } => ({
    o: typeof search.o === "string" ? search.o : undefined,
    i: typeof search.i === "string" ? search.i : undefined,
    r: typeof search.r === "string" ? search.r : undefined,
    tapgo: typeof search.tapgo === "string" ? search.tapgo : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Tap & Go Pay — PesaSwap" },
      {
        name: "description",
        content: "Scan QR, tap to pay. Fastest M-Pesa checkout in Kenya.",
      },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  }),
  component: PayPage,
});

type PaymentState = "idle" | "scanned" | "confirming" | "processing" | "success" | "error";

// A2.2 — `amount` is the line's share of the AUTHORITATIVE bill total (its own
// price plus its proportional slice of tax, service charge and discount), quoted
// by the server. `state` says whether anyone else has already taken it.
type OrderLineItem = {
  id?: string;
  name: string;
  qty: number;
  price: number;
  amount?: number;
  state?: "open" | "yours" | "taken" | "paid";
};

// Server-quoted guest-side fee + the plain-language copy that explains it. The
// page renders this verbatim and never computes a fee of its own (A5.5).
type GuestFeeInfo = {
  enabled: boolean;
  amount: number;
  percent: number;
  fixed: number;
  benefits: string[];
  optOut: string;
};

type PaymentData = {
  till: string;
  amount: number;
  currency?: string;
  merchant: string;
  logoUrl?: string | null;
  poweredBy?: string | null;
  staffId?: string | null;
  venue?: string | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  paidRef?: string | null;
  payLinkId?: string | null;
  paymentIntentToken?: string | null;
  phone?: string | null;
  total?: number | null;
  paid?: number | null;
  remaining?: number | null;
  // Auto-gratuity / service charge already on the bill, set in the POS (A3.2).
  serviceCharge?: number | null;
  guestFee?: GuestFeeInfo | null;
  items?: OrderLineItem[];
  staff?: Array<{ id: string; name: string; role: string }>;
};

function PayPage() {
  const [state, setState] = useState<PaymentState>("idle");
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Split bills: the order's remaining balance after this payer's share, so the
  // success screen can invite the next person to pay the rest.
  const [nextRemaining, setNextRemaining] = useState<number | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payTip, setPayTip] = useState(0);
  const [payStaffId, setPayStaffId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // A2.2 — this phone's own reservation handle. Stable for the life of the tab,
  // so a retry re-competes for the dishes it already holds instead of colliding
  // with itself.
  const claimKeyRef = useRef<string>(newClaimKey());
  const claimedRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const pendingInvoiceRef = useRef<string | null>(null);
  // Public per-merchant branding (logo/name/reseller) for the venue being paid, so
  // the customer sees WHO they're paying — not a generic PesaSwap screen.
  const brand = useBranding(paymentData?.venue ?? undefined);

  // Load the payment SDK while the customer is reviewing the bill.
  useEffect(() => {
    void loadHyperLoader().catch(() => {});
  }, []);

  const search = Route.useSearch();

  // Resolve the payment source from the route's typed search params. This runs on a
  // fresh page load AND on an in-app navigation from the scan flow — so scan → order
  // → pay is one seamless journey with no full-page reload.
  useEffect(() => {
    if (search.tapgo) {
      try {
        const data = decodeTapgoPayload(search.tapgo);
        setPaymentData(data);
        if (data.phone) setCustomerPhone(data.phone);
        setState("scanned");
        startTimeRef.current = Date.now();
      } catch {
        // Invalid QR data
      }
    }
    // Short invoice pay link (/pay?i=INV-XXX) — load the amount by number.
    if (search.i) void loadInvoice(search.i);
    // Server-bound QR order pay link (/pay?o=<token>) — the amount is loaded from
    // the server, never read from the URL, so it cannot be tampered with.
    if (search.o) void loadQrOrder(search.o);
    // Server-bound payment request (/pay?r=<token>) — Tap&Go / deposit / split /
    // ad-hoc link sent over a channel; amount resolved server-side.
    if (search.r) void loadPayLink(search.r);
    // Return from a payment redirect.
    if (search.status === "complete") setState("success");
  }, [search.o, search.i, search.r, search.tapgo, search.status]);

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
        currency: data.currency,
        merchant: data.merchant,
        logoUrl: data.logoUrl ?? null,
        poweredBy: data.poweredBy ?? null,
        staffId: data.staffId ?? null,
        venue: data.venue ?? null,
        invoiceNumber: number,
        paidRef: data.paidRef ?? null,
        guestFee: data.guestFee ?? null,
        paymentIntentToken: data.paymentIntentToken ?? null,
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
    opts?: {
      amount?: number;
      tip?: number;
      staffId?: string | null;
      itemIds?: string[];
    },
  ) {
    setCustomerPhone(phone);
    if (typeof opts?.amount === "number" && opts.amount > 0) {
      setPayAmount(opts.amount);
    }
    setPayTip(opts?.tip ?? 0);
    setPayStaffId(opts?.staffId ?? null);
    // Skip the PIN/fingerprint gate — trigger the M-Pesa payment immediately.
    // (Authorization happens on the customer's phone via the M-Pesa STK prompt.)
    void processRealPayment(phone, {
      amount: opts?.amount,
      tip: opts?.tip ?? 0,
      staffId: opts?.staffId ?? null,
      itemIds: opts?.itemIds,
    });
  }

  // A2.4 — the remaining balance drops on THIS phone the moment another guest
  // pays, over the per-bill Durable Object topic. Polling is the fallback for a
  // network that blocks WebSockets, never the primary path.
  useEffect(() => {
    const token = search.o;
    const orderId = paymentData?.orderId;
    if (!token || !orderId) return;

    let cancelled = false;
    let socket: WebSocket | null = null;
    let poll: number | null = null;

    const applyEvent = (raw: unknown) => {
      const evt = raw as {
        type?: string;
        data?: { remaining?: number; paid?: number; taken_item_ids?: string[] };
      };
      if (cancelled || evt?.type !== "bill.updated" || !evt.data) return;
      setPaymentData((prev) => {
        if (!prev) return prev;
        const taken = evt.data?.taken_item_ids;
        return {
          ...prev,
          paid: typeof evt.data?.paid === "number" ? evt.data.paid : prev.paid,
          remaining:
            typeof evt.data?.remaining === "number"
              ? evt.data.remaining
              : prev.remaining,
          items: taken
            ? (prev.items ?? []).map((item) =>
                item.id && taken.includes(item.id) && item.state !== "yours"
                  ? { ...item, state: "taken" as const }
                  : item,
              )
            : prev.items,
        };
      });
    };

    const startPolling = () => {
      if (poll != null) return;
      let since = new Date().toISOString();
      poll = window.setInterval(() => {
        void fetch(
          `/api/qr/pay/${encodeURIComponent(token)}/live?since=${encodeURIComponent(since)}`,
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { events?: unknown[] } | null) => {
            since = new Date().toISOString();
            (d?.events ?? []).forEach(applyEvent);
          })
          .catch(() => {});
      }, 5000);
    };

    try {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(
        `${scheme}://${window.location.host}/api/qr/pay/${encodeURIComponent(token)}/live`,
      );
      socket.onmessage = (ev) => {
        try {
          applyEvent(JSON.parse(String(ev.data)));
        } catch (error) {
          noteBestEffortFailure("pay.realtime.frame", error);
        }
      };
      socket.onerror = startPolling;
      socket.onclose = () => {
        if (!cancelled) startPolling();
      };
    } catch (error) {
      noteBestEffortFailure("pay.realtime.connect", error);
      startPolling();
    }

    return () => {
      cancelled = true;
      if (poll != null) window.clearInterval(poll);
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
    };
  }, [search.o, paymentData?.orderId]);

  // Hand claimed dishes back the moment this phone stops trying to pay for them.
  async function releaseClaim() {
    if (!claimedRef.current || !search.o) return;
    claimedRef.current = false;
    try {
      await fetch(`/api/qr/pay/${encodeURIComponent(search.o)}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimKey: claimKeyRef.current }),
      });
    } catch (error) {
      // The reservation expires on its own, so the guest is never stuck.
      noteBestEffortFailure("pay.claim.release", error);
    }
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
        currency: data.currency,
        merchant: data.merchant,
        logoUrl: data.logoUrl ?? null,
        poweredBy: data.poweredBy ?? null,
        venue: data.venue ?? null,
        orderId: data.orderId ?? null,
        total: data.total ?? null,
        paid: data.paid ?? null,
        remaining: data.remaining ?? null,
        serviceCharge: data.serviceCharge ?? null,
        guestFee: data.guestFee ?? null,
        items: data.items ?? [],
        staff: data.staff ?? [],
        paymentIntentToken: data.paymentIntentToken ?? null,
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

  // Resolve a server-bound payment request (/pay?r=<token>) — Tap&Go / deposit /
  // split / ad-hoc link sent over a channel. The amount is authoritative (server).
  async function loadPayLink(token: string) {
    setLinkError(false);
    setLinkLoading(true);
    try {
      const res = await fetch(`/api/pay-links/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("invalid");
      const data = (await res.json()) as PaymentData & {
        status?: string;
        payLinkId?: string;
      };
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
        payLinkId: data.payLinkId ?? null,
        guestFee: data.guestFee ?? null,
        paymentIntentToken: data.paymentIntentToken ?? null,
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

  async function processRealPayment(
    phone: string,
    opts?: {
      amount?: number;
      tip?: number;
      staffId?: string | null;
      itemIds?: string[];
    },
  ) {
    if (!paymentData) return;
    setState("processing");
    setErrorMsg("");
    const tip = opts?.tip ?? payTip;

    // A2.2 — reserve the dishes BEFORE charging. The server is the only thing
    // that decides what this guest may pay for: if another phone already took a
    // line (or already paid it), the claim comes back refused and no money moves.
    let chargeAmount = opts?.amount ?? payAmount ?? paymentData.amount;
    let intentToken = paymentData.paymentIntentToken ?? undefined;
    if (opts?.itemIds?.length && search.o) {
      try {
        const res = await fetch(
          `/api/qr/pay/${encodeURIComponent(search.o)}/claim`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              claimKey: claimKeyRef.current,
              itemIds: opts.itemIds,
            }),
          },
        );
        const claim = (await res.json().catch(() => ({}))) as {
          claimed?: string[];
          conflicts?: string[];
          amount?: number;
          clamped?: boolean;
          remaining?: number;
          paymentIntentToken?: string;
          error?: string;
        };
        if (!res.ok || !claim.paymentIntentToken || !claim.amount) {
          claimedRef.current = false;
          markTakenItems(claim.conflicts ?? []);
          setErrorMsg(
            claim.conflicts?.length
              ? "Someone else just took one of those dishes. Pick again — we haven't charged you."
              : (claim.error ?? "We couldn't reserve those items. Please try again."),
          );
          setState("error");
          return;
        }
        claimedRef.current = true;
        chargeAmount = claim.amount;
        intentToken = claim.paymentIntentToken;
        setPayAmount(claim.amount);
        if (typeof claim.remaining === "number") {
          setPaymentData((prev) =>
            prev ? { ...prev, remaining: claim.remaining ?? prev.remaining } : prev,
          );
        }
        if (claim.clamped) {
          toast.info("Someone already covered part of your dishes", {
            description: `You'll pay KES ${claim.amount.toLocaleString()}.`,
          });
        }
      } catch {
        setErrorMsg("We couldn't reserve those items. Please try again.");
        setState("error");
        return;
      }
    }

    const metadata = buildPaymentMetadata({
      merchant: { name: paymentData.merchant, till: paymentData.till },
      flow: paymentData.invoiceNumber ? "invoice" : "tapgo",
      customer: { phone },
    });
    // Attribute the payment + tip to the serving staff: the invoice creator, or the
    // server the guest picked in the tip flow.
    const attributedStaff = opts?.staffId ?? payStaffId ?? paymentData.staffId ?? null;
    if (attributedStaff) {
      (metadata as Record<string, unknown>).staff_id = attributedStaff;
    }
    // A gratuity rides on top of the bill; tip_amount is stored in minor units.
    if (tip > 0) {
      const currency = normalizeCurrency(paymentData.currency) ?? DEFAULT_CURRENCY;
      (metadata as Record<string, unknown>).tip_amount = toMinorUnits(tip, currency);
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
    // Server-bound payment request: tag it so the ledger marks the pay-link paid.
    if (paymentData.payLinkId) {
      (metadata as Record<string, unknown>).pay_link_id = paymentData.payLinkId;
    }
    (metadata as Record<string, unknown>).till = paymentData.till;

    const result = await executePayment({
      amount: chargeAmount + tip,
      currency: normalizeCurrency(paymentData.currency) ?? DEFAULT_CURRENCY,
      metadata,
      phone,
      paymentIntentToken: intentToken,
      onStatusChange: (status: PaymentStatus) => {
        if (status === "processing") setState("processing");
      },
    });

    if (result.success) {
      claimedRef.current = false;
      await finalizeSuccess(result.payment_id || null);
    } else {
      // The charge is dead: give the dishes back to the table immediately rather
      // than leaving them locked until the reservation expires.
      void releaseClaim();
      // Keep the payment id so the guest can re-check a late M-Pesa confirmation
      // (an STK approved after our poll window) WITHOUT paying again.
      setPaymentId(result.payment_id || null);
      setErrorMsg(result.error || "Payment failed. Please try again.");
      setState("error");
    }
  }

  // Reflect a refused claim in the bill immediately, so the guest can see which
  // dish went and re-pick without waiting for the next live event.
  function markTakenItems(ids: string[]) {
    if (ids.length === 0) return;
    setPaymentData((prev) =>
      prev
        ? {
            ...prev,
            items: (prev.items ?? []).map((item) =>
              item.id && ids.includes(item.id)
                ? { ...item, state: "taken" as const }
                : item,
            ),
          }
        : prev,
    );
  }

  // Post-success side effects + receipt. Shared by the direct success path and the
  // "check status again" re-verification, so a late M-Pesa confirmation lands the
  // guest on the exact same receipt (with the M-Pesa REF) as an instant success.
  async function finalizeSuccess(pid: string | null) {
    if (pid) setPaymentId(pid);
    // Split bills: re-fetch the order so the NEXT person sees the updated balance
    // and can push their own share. Each payer keeps their own phone + STK.
    if (paymentData?.orderId && search.o) {
      try {
        const res = await fetch(`/api/qr/pay/${encodeURIComponent(search.o)}`);
        if (res.ok) {
          const d = (await res.json()) as { remaining?: number | null };
          setNextRemaining(
            typeof d.remaining === "number" ? d.remaining : null,
          );
        }
      } catch (error) {
        // A balance refresh is a bonus — never block the receipt.
        noteBestEffortFailure("pay.receipt.balance", error);
      }
    }
    // Invoice payments: the server settles the invoice and stores the M-Pesa
    // receipt (REF) during confirmation. Re-fetch so the same reference shows on
    // the customer's receipt as on the merchant's.
    if (paymentData?.invoiceNumber) {
      try {
        const res = await fetch(
          `/api/invoices/payinfo?number=${encodeURIComponent(paymentData.invoiceNumber)}`,
        );
        if (res.ok) {
          const d = (await res.json()) as { paidRef?: string | null };
          if (d.paidRef) {
            setPaymentData((prev) =>
              prev ? { ...prev, paidRef: d.paidRef } : prev,
            );
          }
        }
      } catch (error) {
        // The receipt REF is a bonus — never block the receipt.
        noteBestEffortFailure("pay.receipt.ref", error);
      }
    }
    setState("success");
  }

  // "I've already paid — check again": re-poll the authoritative payment status
  // so a late M-Pesa confirmation is caught without charging the guest twice. The
  // status endpoint records the ledger on first success, so this is safe + idempotent.
  async function verifyPaymentStatus() {
    if (!paymentId) return;
    setVerifying(true);
    try {
      const res = await fetch(
        `/api/payments/${encodeURIComponent(paymentId)}/status`,
      );
      if (res.ok) {
        const d = (await res.json()) as { status?: string };
        if (d.status === "succeeded") {
          await finalizeSuccess(paymentId);
          return;
        }
      }
      toast.error("Not confirmed yet", {
        description:
          "If you approved the M-Pesa prompt, give it a moment and check again.",
      });
    } catch {
      toast.error("Couldn't check the payment status. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  function reset() {
    void releaseClaim();
    setState("idle");
    setPaymentData(null);
    setCustomerPhone("");
    setPayAmount(null);
    setPayTip(0);
    setPayStaffId(null);
    setPaymentId(null);
    setNextRemaining(null);
    setErrorMsg("");
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/pay");
    }
  }

  function retryPayment(overrideAmount?: number) {
    setErrorMsg("");
    // Re-fire the SAME payment seamlessly (same phone + share) — or with a new
    // amount when the guest edits it — instead of making them re-enter everything.
    if (paymentData && customerPhone) {
      if (typeof overrideAmount === "number" && overrideAmount > 0) {
        setPayAmount(overrideAmount);
        void processRealPayment(customerPhone, { amount: overrideAmount });
      } else {
        void processRealPayment(customerPhone);
      }
    } else {
      setState("scanned");
    }
  }

  // Split bills: hand the phone to the next person. Reloads the order so they see the
  // remaining balance and push their own share on their own number.
  function payNextShare() {
    // A fresh payer on the same handset gets a fresh reservation handle.
    void releaseClaim();
    claimKeyRef.current = newClaimKey();
    setNextRemaining(null);
    setErrorMsg("");
    setPayAmount(null);
    setPayTip(0);
    setPaymentId(null);
    if (search.o) void loadQrOrder(search.o);
    else setState("scanned");
  }

  // Demo: simulate scanning
  // Handle a scanned QR value. App QR codes encode a URL: a table code (/q/:code),
  // a QR order pay link (/pay?o=), or an invoice link (/pay?i=). Resolve it in place.
  function handleScan(value: string) {
    setScannerOpen(false);
    try {
      const u = new URL(value.trim(), window.location.origin);
      if (u.pathname.startsWith("/q/")) {
        window.location.href = u.pathname + u.search;
        return;
      }
      const o = u.searchParams.get("o");
      const i = u.searchParams.get("i");
      if (o) {
        void loadQrOrder(o);
        return;
      }
      if (i) {
        void loadInvoice(i);
        return;
      }
    } catch {
      /* not a recognised URL — fall through */
    }
  }

  return (
    <main
      className="min-h-screen bg-background flex items-center justify-center p-4"
      aria-busy={state === "processing" || linkLoading}
    >
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          {brand?.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.businessName}
              className="mx-auto mb-3 h-9 w-auto max-w-[160px] object-contain"
            />
          ) : brand?.businessName ? (
            <p className="mb-2 text-lg font-bold">{brand.businessName}</p>
          ) : null}
          <div className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-4 py-2 mb-2">
            <Zap className="size-4" />
            <span className="text-sm font-bold font-mono">Tap&Go</span>
          </div>
          {brand?.reseller?.poweredBy ? (
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {brand.reseller.poweredBy}
            </p>
          ) : null}
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
          <IdleState onScan={() => setScannerOpen(true)} />
        )}
        {state === "scanned" && paymentData && (
          <ScannedState data={paymentData} onConfirm={confirmPayment} onCancel={reset} />
        )}
        {state === "processing" && <div role="status" aria-live="polite"><ProcessingState /></div>}
        {state === "error" && (
          <ErrorState
            message={errorMsg}
            amount={(payAmount ?? paymentData?.amount ?? 0) + payTip}
            onRetry={retryPayment}
            onCancel={reset}
            onVerify={paymentId ? verifyPaymentStatus : undefined}
            verifying={verifying}
          />
        )}
        {state === "success" && paymentData && (
          <SuccessState
            data={paymentData}
            phone={customerPhone}
            paymentId={paymentId}
            amountPaid={(payAmount ?? paymentData.amount) + payTip}
            tip={payTip}
            elapsedMs={Date.now() - startTimeRef.current}
            nextRemaining={nextRemaining}
            onNext={payNextShare}
            onDone={reset}
          />
        )}
      </div>
      {scannerOpen ? (
        <QrScanner
          onResult={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      ) : null}
    </main>
  );
}

// A2.2 — an opaque per-guest reservation handle. It identifies this phone's
// claim on the bill; it is not a credential for anything else.
function newClaimKey(): string {
  return `c${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 33);
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
    opts?: {
      amount?: number;
      tip?: number;
      staffId?: string | null;
      itemIds?: string[];
    },
  ) => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState(() => localMpesaDigits(data.phone));
  const remaining =
    typeof data.remaining === "number" ? data.remaining : data.amount;
  const canSplit = Boolean(data.orderId) && typeof data.remaining === "number";
  const items = data.items ?? [];
  // A2.2 — only lines the server says are still open can be picked. A line
  // someone else reserved or already paid is rendered, disabled and labelled,
  // never hidden: the guest needs to understand why they cannot select it.
  const claimableItems = items.filter((it) => Boolean(it.id));
  const partiallyPaid = typeof data.paid === "number" && data.paid > 0;
  const [mode, setMode] = useState<"full" | "equal" | "item" | "custom">(
    "full",
  );
  const [people, setPeople] = useState(2);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState("");
  const staff = data.staff ?? [];
  // "none" | "custom" | the additional-tip percentage of the chosen tier.
  const [tipChoice, setTipChoice] = useState<"none" | "custom" | number>("none");
  const [customTip, setCustomTip] = useState("");
  const [tipStaff, setTipStaff] = useState("");

  // Drop a selection the moment another guest takes that dish out from under it.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const stillOpen = new Set(
        claimableItems
          .filter((it) => it.state !== "taken" && it.state !== "paid")
          .map((it) => it.id as string),
      );
      const next = new Set([...current].filter((id) => stillOpen.has(id)));
      return next.size === current.size ? current : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const clamp = (n: number) =>
    Math.max(0, Math.min(remaining, Math.round(n || 0)));
  let share = remaining;
  if (mode === "equal") share = clamp(remaining / Math.max(1, people));
  else if (mode === "item")
    share = clamp(
      claimableItems.reduce(
        (s, it) =>
          selected.has(it.id as string)
            ? // The server-quoted apportioned share carries this line's slice of
              // tax/service/discount; the raw price is only a fallback.
              s + (typeof it.amount === "number" ? it.amount : it.qty * it.price)
            : s,
        0,
      ),
    );
  else if (mode === "custom") share = clamp(Number(custom) || 0);

  // A3.2 — the tip options adapt to the auto-gratuity the POS already put on the
  // bill. The guest's share carries a proportional slice of that service charge,
  // so a split payer is tiered against what THEY are covering, not the whole
  // check. No service charge (or an unknown one) falls back to 20/23/25%.
  const billTotal = Number(data.total) || remaining;
  const serviceCharge = Math.max(0, Number(data.serviceCharge) || 0);
  const shareOfServiceCharge =
    billTotal > 0 ? (serviceCharge * share) / billTotal : 0;
  const tipPlan = tipTiersFor(share, shareOfServiceCharge);
  const tipNotice = tipTierNotice(tipPlan);
  const selectedTier =
    typeof tipChoice === "number"
      ? tipPlan.tiers.find((t) => t.pct === tipChoice)
      : undefined;

  const tip =
    tipChoice === "custom"
      ? Math.max(0, Math.round(Number(customTip) || 0))
      : (selectedTier?.amount ?? 0);
  const guestFee = data.guestFee ?? null;
  const guestFeeAmount = Math.max(0, Number(guestFee?.amount) || 0);
  const total = share + tip + guestFeeAmount;

  const toggleItem = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
            // A2.4 — this line changes under the guest's thumb as other people on
            // the table pay, so it is a polite live region rather than static text.
            <p
              className="text-[11px] font-mono opacity-60 mt-1"
              aria-live="polite"
              aria-atomic="true"
            >
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
                aria-pressed={mode === m.key}
                className={`min-h-[44px] rounded-xl px-2 py-2 text-[11px] font-semibold ${
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
            <div className="space-y-2">
              {claimableItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No itemised bill available.
                </p>
              ) : (
                <>
                  <p
                    id="split-item-help"
                    className="text-[11px] leading-snug text-muted-foreground"
                  >
                    Pick the dishes you had. Each price already includes your
                    share of any service charge, tax and discount. Nothing is
                    reserved until you tap pay.
                  </p>
                  <ul className="max-h-56 space-y-2 overflow-y-auto">
                    {claimableItems.map((it) => {
                      const id = it.id as string;
                      const takenByOther =
                        it.state === "taken" || it.state === "paid";
                      const isSelected = selected.has(id);
                      const lineAmount =
                        typeof it.amount === "number"
                          ? it.amount
                          : it.qty * it.price;
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => toggleItem(id)}
                            disabled={takenByOther}
                            aria-pressed={isSelected}
                            aria-describedby="split-item-help"
                            className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                              isSelected
                                ? "border-emerald-500 bg-emerald-50"
                                : "border-border bg-background"
                            }`}
                          >
                            <span>
                              {it.qty}× {it.name}
                              {takenByOther ? (
                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {it.state === "paid"
                                    ? "Already paid"
                                    : "Taken by someone else"}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 font-mono">
                              KES {lineAmount.toLocaleString()}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
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
          {tipNotice ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {tipNotice}
            </p>
          ) : null}
          <div className="grid grid-cols-5 gap-2">
            <button
              type="button"
              onClick={() => setTipChoice("none")}
              className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${
                tipChoice === "none"
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              None
            </button>
            {tipPlan.tiers.map((o) => (
              <button
                key={o.pct}
                type="button"
                onClick={() => setTipChoice(o.pct)}
                className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${
                  tipChoice === o.pct
                    ? "bg-emerald-600 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {o.pct}%
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTipChoice("custom")}
              className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${
                tipChoice === "custom"
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              Custom
            </button>
          </div>
          {tipChoice === "custom" ? (
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
              Tip KES {tip.toLocaleString()}
              {selectedTier && tipPlan.includedAmount > 0
                ? ` · about ${selectedTier.combinedPct}% in total with the service charge`
                : ""}{" "}
              · You pay KES {total.toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* A5.5 — what paying from your phone costs, stated BEFORE you commit.
          The amount is quoted by the server; this screen never computes one. */}
      {guestFee ? (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Service fee
            </p>
            <p className="text-sm font-mono font-bold">
              {guestFeeAmount > 0
                ? `KES ${guestFeeAmount.toLocaleString()}`
                : "None"}
            </p>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {guestFeeAmount > 0
              ? "An optional fee for paying from your phone:"
              : "You pay your bill and any tip you choose — nothing extra. Paying from your phone gets you:"}
          </p>
          <ul className="space-y-1">
            {(guestFee.benefits ?? []).map((b) => (
              <li
                key={b}
                className="flex gap-2 text-[11px] leading-snug text-muted-foreground"
              >
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {guestFee.optOut ? (
            <p className="text-[10px] leading-snug text-muted-foreground">
              {guestFee.optOut}
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
            itemIds:
              mode === "item" ? Array.from(selected) : undefined,
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
        className="w-full min-h-[44px] border border-border py-3 rounded-2xl text-sm text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function ProcessingState() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-5">
      <div className="relative">
        <div className="size-16 rounded-full border-4 border-foreground border-t-transparent animate-spin" />
        <Smartphone className="absolute inset-0 m-auto size-6 text-foreground" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold">Waiting for your M-Pesa PIN…</p>
        <p className="text-[11px] text-muted-foreground">
          Check your phone and enter your M-Pesa PIN to approve.
        </p>
        <p className="text-[11px] font-mono text-muted-foreground">{elapsed}s</p>
      </div>
      {elapsed >= 20 && (
        <p className="max-w-[15rem] text-center text-[11px] text-muted-foreground">
          Taking a moment? The prompt can take up to a minute. Keep this page
          open — it updates automatically once you approve.
        </p>
      )}
    </div>
  );
}

function ErrorState({
  message,
  amount,
  onRetry,
  onCancel,
  onVerify,
  verifying,
}: {
  message: string;
  amount: number;
  onRetry: (newAmount?: number) => void;
  onCancel: () => void;
  onVerify?: () => void;
  verifying?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState(String(Math.round(amount)));
  const newAmount = Math.max(0, Math.round(Number(amt) || 0));
  const changed = newAmount !== Math.round(amount) && newAmount > 0;

  const bump = (delta: number) =>
    setAmt(String(Math.max(0, (Number(amt) || 0) + delta)));

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center py-6 space-y-4">
        <div className="size-20 rounded-full bg-red-100 flex items-center justify-center">
          <AlertCircle className="size-12 text-red-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-red-700">Payment didn&apos;t go through</p>
          <p className="text-sm text-muted-foreground mt-2">{message}</p>
        </div>
      </div>

      {editing ? (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            New amount
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => bump(-50)}
              className="size-11 shrink-0 rounded-xl border border-border text-lg font-bold text-muted-foreground"
              aria-label="Decrease amount"
            >
              −
            </button>
            <div className="flex-1 flex items-center rounded-xl border border-border bg-background px-3">
              <span className="text-sm font-mono font-bold text-muted-foreground">
                KES
              </span>
              <input
                type="tel"
                inputMode="numeric"
                value={amt}
                onChange={(e) => setAmt(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full bg-transparent px-2 py-3 text-center text-2xl font-bold font-mono focus:outline-none"
                aria-label="New amount in KES"
              />
            </div>
            <button
              onClick={() => bump(50)}
              className="size-11 shrink-0 rounded-xl border border-border text-lg font-bold text-muted-foreground"
              aria-label="Increase amount"
            >
              +
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {[100, 200, 500, 1000].map((v) => (
              <button
                key={v}
                onClick={() => setAmt(String(v))}
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
              >
                KES {v.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-muted p-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Amount
          </p>
          <p className="text-2xl font-bold font-mono mt-1">
            KES {Math.round(amount).toLocaleString()}
          </p>
        </div>
      )}

      {onVerify && (
        <button
          onClick={onVerify}
          disabled={verifying}
          className="w-full border border-emerald-300 bg-emerald-50 text-emerald-800 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {verifying ? (
            <span className="size-4 rounded-full border-2 border-emerald-700 border-t-transparent animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {verifying ? "Checking…" : "I've already paid — check status"}
        </button>
      )}

      <button
        onClick={() => onRetry(editing && changed ? newAmount : undefined)}
        disabled={editing && newAmount <= 0}
        className="w-full bg-emerald-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Zap className="size-5" />
        {editing && changed
          ? `Retry with KES ${newAmount.toLocaleString()}`
          : "Try again"}
      </button>

      <button
        onClick={() => setEditing((v) => !v)}
        className="w-full border border-border py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
      >
        <Pencil className="size-4" />
        {editing ? "Keep original amount" : "Change amount"}
      </button>

      <button
        onClick={onCancel}
        className="w-full py-2 rounded-2xl text-sm text-muted-foreground"
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
  amountPaid,
  tip,
  elapsedMs,
  nextRemaining,
  onNext,
  onDone,
}: {
  data: PaymentData;
  phone: string;
  paymentId: string | null;
  amountPaid: number;
  tip: number;
  elapsedMs: number;
  nextRemaining?: number | null;
  onNext?: () => void;
  onDone: () => void;
}) {
  const elapsedSec = Math.round(elapsedMs / 1000);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [portalChallenge, setPortalChallenge] = useState<string | null>(null);
  const [portalCode, setPortalCode] = useState("");
  const [portalDevCode, setPortalDevCode] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const pointsEarned = loyaltyPointsFor(amountPaid * 100);

  async function requestPortalCode() {
    const venue = data.venue;
    if (!venue || !phone) return;
    setPortalBusy(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/portal/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venue, phone, channel: "sms" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        challengeId?: string;
        devCode?: string;
        error?: string;
      };
      if (!res.ok || !body.challengeId) throw new Error(body.error ?? "Could not send code.");
      setPortalChallenge(body.challengeId);
      setPortalDevCode(body.devCode ?? null);
    } catch (error) {
      setPortalError(error instanceof Error ? error.message : "Could not send code.");
    } finally {
      setPortalBusy(false);
    }
  }

  async function verifyPortalCode() {
    if (!portalChallenge || !data.venue || !phone) return;
    setPortalBusy(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/portal/token/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: portalChallenge,
          venue: data.venue,
          phone,
          channel: "sms",
          code: portalCode,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Invalid code.");
      setPortalUrl(`${window.location.origin}${body.url}`);
    } catch (error) {
      setPortalError(error instanceof Error ? error.message : "Invalid code.");
    } finally {
      setPortalBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center py-6 space-y-4">
        <div className="size-24 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="size-14 text-emerald-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-700">Payment successful!</p>
          <p className="text-3xl font-bold font-mono mt-2">KES {amountPaid.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground mt-1">{data.merchant}</p>
        </div>
      </div>

      {typeof nextRemaining === "number" && nextRemaining > 0 ? (
        <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 text-center space-y-3">
          <p className="text-sm font-bold text-emerald-800">
            Your share is paid — thank you! 🎉
          </p>
          <p className="text-2xl font-bold font-mono text-emerald-700">
            KES {nextRemaining.toLocaleString()} still due
          </p>
          <p className="text-[11px] text-emerald-700">
            Hand the phone to the next person — they pay their share on their own
            M-Pesa number.
          </p>
          {onNext ? (
            <button
              onClick={onNext}
              className="w-full bg-emerald-600 text-white py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
            >
              <Zap className="size-4" /> Next person pays
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-2xl bg-muted p-4 space-y-2">
        {(
          [
            ["Merchant", data.merchant],
            ...(data.invoiceNumber
              ? ([["Invoice", data.invoiceNumber]] as Array<[string, string]>)
              : ([["Till", data.till]] as Array<[string, string]>)),
            ...(tip > 0
              ? ([
                  ["Bill", `KES ${(amountPaid - tip).toLocaleString()}`],
                  ["Tip", `KES ${tip.toLocaleString()}`],
                ] as Array<[string, string]>)
              : []),
            ["Amount paid", `KES ${amountPaid.toLocaleString()}`],
            ["Phone", phone ? `${phone.slice(0, 4)}***${phone.slice(-3)}` : "—"],
            ["Method", "M-Pesa via PesaSwap"],
            ...(data.paidRef
              ? ([["M-Pesa REF", data.paidRef]] as Array<[string, string]>)
              : []),
            ["Time", new Date().toLocaleTimeString()],
            [
              "Reference",
              paymentId || `TG${Date.now().toString(36).toUpperCase()}`,
            ],
          ] as Array<[string, string]>
        ).map(([k, v]) => (
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

      {pointsEarned > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
          {pointsEarned > 0 ? (
            <p className="text-sm font-bold text-amber-700">
              +{pointsEarned.toLocaleString()} points earned 🎉
            </p>
          ) : null}
        </div>
      ) : null}

      {!portalUrl && data.venue && phone ? (
        <div className="rounded-2xl border border-emerald-200 bg-white p-4 text-center space-y-3">
          <p className="text-sm font-bold">Verify to access rewards &amp; receipts</p>
          {!portalChallenge ? (
            <button
              type="button"
              onClick={() => void requestPortalCode()}
              disabled={portalBusy}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {portalBusy ? "Sending…" : "Send verification code"}
            </button>
          ) : (
            <div className="space-y-2">
              <input
                value={portalCode}
                onChange={(event) =>
                  setPortalCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code"
                className="w-full rounded-xl border border-border px-3 py-3 text-center font-mono"
              />
              {portalDevCode ? (
                <p className="text-[10px] text-muted-foreground">Development code: {portalDevCode}</p>
              ) : null}
              <button
                type="button"
                onClick={() => void verifyPortalCode()}
                disabled={portalBusy || portalCode.length !== 6}
                className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {portalBusy ? "Verifying…" : "Verify & open portal"}
              </button>
            </div>
          )}
          {portalError ? <p className="text-xs text-red-600">{portalError}</p> : null}
          <p className="text-[10px] text-muted-foreground">
            The verified link expires in 30 days and replaces older links.
          </p>
        </div>
      ) : null}

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
// relationship". A rating at or above the venue's configured threshold is sent
// straight to the venue's Google review form (prefilled with the place, so
// posting takes seconds); anything below is captured privately and flagged to
// the team for service recovery instead of being pushed onto a public profile.
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
  const [minRating, setMinRating] = useState(4);
  const [googleUrl, setGoogleUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!venue) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/reviews/prompt?venue=${encodeURIComponent(venue)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { minRating?: number };
        if (typeof data.minRating === "number") setMinRating(data.minRating);
      } catch {
        /* the default threshold is a safe fallback */
      }
    })();
  }, [venue]);

  if (!venue) return null;

  async function submit(stars: number, withComment = false) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/reviews?venue=${encodeURIComponent(venue as string)}`,
        {
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
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        destination?: string;
        googleUrl?: string | null;
      };
      // The server owns the decision — the client never routes a rating to a
      // public profile on its own.
      if (data.destination === "google" && data.googleUrl) {
        setGoogleUrl(data.googleUrl);
        window.open(data.googleUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      // Never block a guest from leaving over a rating.
      noteBestEffortFailure("pay.review.submit", error);
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center space-y-2">
        <p className="text-sm font-bold">Thanks for the feedback! 🙏</p>
        {googleUrl ? (
          <a
            href={googleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-bold text-amber-700 underline"
          >
            Post it on Google →
          </a>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            We&apos;ve shared this with the team so we can make it right.
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
              if (s >= minRating) void submit(s);
            }}
          >
            <Star
              className={`size-8 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
            />
          </button>
        ))}
      </div>
      {rating > 0 && rating < minRating ? (
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
