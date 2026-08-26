import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock3, QrCode, Send, Share2, X, Zap } from "lucide-react";

import {
  buildPaymentMetadata,
  executePayment,
} from "../../../lib/pesaswap-payments";
import { authFetch, hasAuthoritativeVenueSession } from "@/lib/auth";
import { PaymentQr } from "@/components/pay/PaymentQr";
import { useMerchantIdentity } from "@/lib/use-merchant-identity";
import { getCurrentVenueId } from "@/lib/tenant-store";
import { useOfflineQueue } from "@/lib/use-offline-queue";
import {
  isSettledPayment,
  netSettledAmount,
} from "@/lib/payment-ledger";
import { usePaymentLedger } from "@/lib/use-payment-ledger";
import { usePaymentConfig } from "@/lib/use-payment-config";
import { OmniShare } from "../OmniShare";
import type { TapGoTransaction } from "./types";

export function TapGoPOS() {
  const { name: MERCHANT_NAME, till: TILL_NUMBER } = useMerchantIdentity();
  const offline = useOfflineQueue();
  const paymentLedger = usePaymentLedger(100);
  const paymentConfig = usePaymentConfig();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"keypad" | "qr" | "waiting" | "success">(
    "keypad",
  );
  const [transactions, setTransactions] = useState<TapGoTransaction[]>([]);
  const [currentTx, setCurrentTx] = useState<TapGoTransaction | null>(null);
  const [customerNumber, setCustomerNumber] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [minting, setMinting] = useState(false);

  async function initiatePayment() {
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
    setMinting(true);
    try {
      const url = await createPayLink(tx.id);
      if (!url) {
        setCurrentTx(null);
        return;
      }
      setShareLink(url);
      setShareOpen(false);
      setMode("qr");
    } finally {
      setMinting(false);
    }
  }

  async function simulatePaymentReceived(phone?: string) {
    if (!currentTx) return;
    const tx = currentTx;

    if (!hasAuthoritativeVenueSession()) {
      const completedTx: TapGoTransaction = {
        ...tx,
        status: "confirmed",
        method: phone ? "STK Push" : "QR Scan",
        customerPhone: phone
          ? phone.slice(0, 4) + "***" + phone.slice(-3)
          : "Demo customer",
      };
      setTransactions((prev) => [completedTx, ...prev]);
      setCurrentTx(completedTx);
      setMode("success");
      toast.success("Demo payment simulated", {
        description: "No money moved and no database ledger entry was created.",
      });
      return;
    }

    const metadata = buildPaymentMetadata({
      merchant: { name: MERCHANT_NAME, till: TILL_NUMBER, id: getCurrentVenueId() },
      flow: "tapgo",
      customer: { phone: phone || "0722000000" },
    });
    const minorAmount = tx.amount * 100;

    function queueForLater(note: string) {
      // Preserve a draft only. Money movement needs a fresh online intent and
      // explicit review after reconnecting; drafts are never auto-submitted.
      offline.enqueue({
        id: tx.id,
        amount: minorAmount,
        currency: "KES",
        metadata: metadata as unknown as Record<string, unknown>,
      });
      toast.success("Draft saved", { description: note });
      setMode("keypad");
      setAmount("");
      setCurrentTx(null);
      setCustomerNumber("");
    }

    // Offline: queue immediately without hitting the network.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      queueForLater("Reconnect, review this draft, and start a fresh payment.");
      return;
    }

    setMode("waiting");

    try {
      // Bind venue, amount and source on the authenticated server before any
      // public checkout call can move money. Payment creation alone is not
      // confirmation; executePayment waits for the provider-authoritative state.
      const intentResponse = await authFetch("/api/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: minorAmount,
          currency: "KES",
          sourceId: tx.id,
          metadata,
        }),
      });
      const intent = (await intentResponse.json().catch(() => ({}))) as {
        paymentIntentToken?: string;
        error?: { message?: string } | string;
      };
      if (!intentResponse.ok || !intent.paymentIntentToken) {
        const message =
          typeof intent.error === "string"
            ? intent.error
            : intent.error?.message;
        throw new Error(message || "Could not secure this payment request.");
      }

      const result = await executePayment({
        amount: tx.amount,
        currency: "KES",
        metadata,
        phone: phone || "0722000000",
        paymentIntentToken: intent.paymentIntentToken,
      });

      if (!result.success) {
        const pending = result.status === "processing";
        if (result.payment_id) {
          setTransactions((prev) => [
            {
              ...tx,
              id: result.payment_id!,
              status: pending ? "pending" : "failed",
              method: phone ? "STK Push" : "QR Scan",
              customerPhone: phone
                ? phone.slice(0, 4) + "***" + phone.slice(-3)
                : "Not provided",
            },
            ...prev,
          ]);
        }
        void paymentLedger.refetch();
        throw new Error(
          pending
            ? "Payment is still processing. Check the ledger before retrying."
            : result.error || "Payment was not completed.",
        );
      }

      const completedTx: TapGoTransaction = {
        ...tx,
        id: result.payment_id || tx.id,
        status: "confirmed",
        method: phone ? "STK Push" : "QR Scan",
        customerPhone: phone
          ? phone.slice(0, 4) + "***" + phone.slice(-3)
          : "0722***" + Math.floor(100 + Math.random() * 900),
      };
      setTransactions((prev) => [completedTx, ...prev]);
      void paymentLedger.refetch();
      setCurrentTx(completedTx);
      setMode("success");
    } catch (err) {
      // A network failure (fetch rejects with a TypeError) means we simply
      // couldn't reach the server — preserve a draft for explicit review. A
      // real server decline is surfaced as an error instead.
      if (err instanceof TypeError) {
        queueForLater(
          "We couldn't reach the network. Reconnect and review before charging.",
        );
        return;
      }
      toast.error(
        "Payment failed: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
      setMode("keypad");
    }
  }

  async function createPayLink(reference: string): Promise<string | null> {
    if (!amount || Number(amount) <= 0) return null;
    if (!hasAuthoritativeVenueSession()) {
      const payload = btoa(
        JSON.stringify({
          amount: Number(amount),
          merchant: MERCHANT_NAME,
          till: TILL_NUMBER,
          demo: true,
        }),
      );
      return `${window.location.origin}/pay?tapgo=${encodeURIComponent(payload)}`;
    }
    try {
      const res = await authFetch("/api/pay-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountKes: Number(amount),
          kind: "tapgo",
          description: `Tap&Go payment to ${MERCHANT_NAME}`,
          reference,
          phone: customerNumber ? `+254${customerNumber}` : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        toast.error(data.error || "Couldn't create the pay link");
        return null;
      }
      return data.url;
    } catch {
      toast.error("Couldn't create the pay link");
      return null;
    }
  }

  async function mintPayLink() {
    if (!currentTx) return;
    if (shareLink) {
      setShareOpen(true);
      return;
    }
    setMinting(true);
    try {
      const url = await createPayLink(currentTx.id);
      if (url) {
        setShareLink(url);
        setShareOpen(true);
      }
    } finally {
      setMinting(false);
    }
  }

  const liveToday = useMemo(() => {
    const now = new Date();
    return (paymentLedger.data ?? []).filter((payment) => {
      const created = new Date(payment.createdAt);
      return (
        payment.flowType === "tapgo" &&
        created.getFullYear() === now.getFullYear() &&
        created.getMonth() === now.getMonth() &&
        created.getDate() === now.getDate()
      );
    });
  }, [paymentLedger.data]);
  const hasAuthoritativeLedger = paymentLedger.isSuccess;
  const todayTotal = hasAuthoritativeLedger
    ? netSettledAmount(liveToday) / 100
    : transactions
        .filter((transaction) => transaction.status === "confirmed")
        .reduce((sum, transaction) => sum + transaction.amount, 0);
  const todayCount = hasAuthoritativeLedger
    ? liveToday.filter(isSettledPayment).length
    : transactions.filter((transaction) => transaction.status === "confirmed")
        .length;
  const avgTime = 8; // seconds (simulated)

  if (mode === "success" && currentTx) {
    return (
      <div className="px-5 pt-3 flex flex-col items-center justify-center h-full space-y-4">
        <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center animate-bounce">
          <CheckCircle2 className="size-10 text-emerald-600" />
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold font-mono">
            KES {currentTx.amount.toLocaleString()}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Payment confirmed
          </p>
          <p className="text-[10px] font-mono text-muted-foreground mt-2">
            {currentTx.customerPhone} · {currentTx.id}
          </p>
        </div>
        <div className="flex items-center gap-2 text-emerald-600">
          <Clock3 className="size-4" />
          <span className="text-sm font-mono font-bold">{avgTime}s</span>
          <span className="text-xs text-muted-foreground">checkout time</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setMode("keypad");
            setAmount("");
            setCurrentTx(null);
            setCustomerNumber("");
            setShareLink(null);
            setShareOpen(false);
          }}
          className="min-h-11 rounded-xl bg-foreground px-5 text-sm font-semibold text-background"
        >
          New payment
        </button>
      </div>
    );
  }

  if (mode === "waiting") {
    return (
      <div className="px-5 pt-3 flex flex-col items-center justify-center h-full space-y-4">
        <div className="size-16 rounded-full border-4 border-foreground border-t-transparent animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold">Waiting for payment...</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            STK push sent to customer
          </p>
          <p className="text-2xl font-bold font-mono mt-3">
            KES {currentTx?.amount.toLocaleString()}
          </p>
        </div>
      </div>
    );
  }

  if (mode === "qr") {
    return (
      <div className="px-5 pt-3 space-y-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Tap & Go
            </p>
            <h1 className="text-lg font-bold">
              Collect KES {Number(amount).toLocaleString()}
            </h1>
          </div>
          <button
            onClick={() => {
              setMode("keypad");
              setCurrentTx(null);
              setCustomerNumber("");
              setShareLink(null);
              setShareOpen(false);
            }}
            className="size-8 rounded-full bg-muted flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rounded-2xl bg-foreground text-background p-4 text-center">
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">
            Amount to pay
          </p>
          <p className="text-3xl font-bold font-mono mt-1">
            KES {Number(amount).toLocaleString()}
          </p>
          <p className="text-[10px] opacity-60 mt-1">
            Till {TILL_NUMBER} · {MERCHANT_NAME}
          </p>
        </div>

        {/* Option 1: QR Code */}
        <div className="rounded-2xl border border-border bg-background p-4 flex flex-col items-center gap-2">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            Option 1 · Customer scans QR
          </p>
          <PaymentQr
            merchantName={MERCHANT_NAME}
            till={TILL_NUMBER}
            amountMinor={Math.round(Number(amount) * 100)}
            reference={currentTx?.id ?? null}
            cameraUrl={shareLink}
            defaultMode="camera"
            keqr={false}
            size={160}
          />
          <p className="max-w-xs text-center text-[9px] text-muted-foreground">
            This secure link records the attempt, confirmation, tip, refund and
            receipt in the same venue ledger.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[9px] font-mono uppercase text-muted-foreground">
            or
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Option 2: Enter phone number → STK push */}
        <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            Option 2 · Enter phone → STK push
          </p>
          <div className="flex gap-2">
            <div className="rounded-xl border border-border bg-muted px-3 py-3 flex items-center">
              <span className="text-sm font-mono font-bold">+254</span>
            </div>
            <input
              type="tel"
              value={customerNumber}
              onChange={(e) =>
                setCustomerNumber(
                  e.target.value.replace(/[^0-9]/g, "").slice(0, 9),
                )
              }
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

        {paymentConfig.testMode ? (
          <button
            onClick={() => simulatePaymentReceived()}
            className="w-full border border-border py-3 rounded-xl text-xs font-mono text-muted-foreground flex items-center justify-center gap-2"
          >
            <Zap className="size-3.5" />
            Simulate payment received (sandbox)
          </button>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[9px] font-mono uppercase text-muted-foreground">
            or send a link
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Option 3: Send a server-bound pay link over WhatsApp / Telegram / SMS */}
        <button
          onClick={() => void mintPayLink()}
          disabled={minting}
          className="w-full bg-emerald-600 text-white py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Share2 className="size-4" />
          {minting ? "Creating link…" : "Send pay link (WhatsApp/Telegram/SMS)"}
        </button>

        {shareLink && shareOpen ? (
          <OmniShare
            kind="payment_link"
            open
            onClose={() => setShareOpen(false)}
            title={`Send KES ${Number(amount).toLocaleString()} pay link`}
            message={`Here's your secure payment link for KES ${Number(amount).toLocaleString()}. Tap to pay 👇`}
            link={shareLink}
            defaultPhone={customerNumber ? `+254${customerNumber}` : ""}
          />
        ) : null}
      </div>
    );
  }

  // Keypad mode (default)
  return (
    <div className="px-5 pt-3 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Tap & Go POS
          </p>
          <h1 className="text-lg font-bold">Enter amount</h1>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-mono text-muted-foreground">
            Till {TILL_NUMBER}
          </p>
          <p className="text-[9px] font-mono text-emerald-600">● Live</p>
        </div>
      </div>

      {/* Amount Display */}
      <div className="rounded-2xl bg-muted p-6 text-center">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          KES
        </p>
        <p className="text-5xl font-bold font-mono mt-1">
          {amount ? Number(amount).toLocaleString() : "0"}
        </p>
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map(
          (key) => (
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
          ),
        )}
      </div>

      {/* Generate QR Button */}
      <button
        disabled={!amount || Number(amount) <= 0}
        onClick={() => void initiatePayment()}
        className="w-full bg-foreground text-background py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <QrCode className="size-5" />
        Generate payment QR
      </button>

      {/* Today's Stats */}
      {(hasAuthoritativeLedger ? liveToday.length > 0 : transactions.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2 text-center">
            <p className="text-sm font-bold font-mono text-emerald-700">
              KES {(todayTotal / 1000).toFixed(1)}k
            </p>
            <p className="text-[8px] font-mono uppercase text-emerald-600">
              Today
            </p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-2 text-center">
            <p className="text-sm font-bold font-mono text-blue-700">
              {todayCount}
            </p>
            <p className="text-[8px] font-mono uppercase text-blue-600">Txns</p>
          </div>
          <div className="rounded-xl bg-purple-50 border border-purple-200 p-2 text-center">
            <p className="text-sm font-bold font-mono text-purple-700">
              {avgTime}s
            </p>
            <p className="text-[8px] font-mono uppercase text-purple-600">
              Avg time
            </p>
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            Recent
          </p>
          {transactions.slice(0, 3).map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between p-2.5 rounded-xl bg-card border border-border"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500" />
                <div>
                  <p className="text-[11px] font-mono font-bold">
                    KES {tx.amount.toLocaleString()}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    {tx.customerPhone}
                  </p>
                </div>
              </div>
              <p className="text-[9px] font-mono text-muted-foreground">
                {new Date(tx.timestamp).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
