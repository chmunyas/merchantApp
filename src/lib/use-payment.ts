/**
 * Payment orchestration hooks — extracted from route files.
 * Encapsulates the payment state machine and PesaSwap SDK calls.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  executePayment,
  buildPaymentMetadata,
  loadHyperLoader,
  type PaymentStatus,
  type PaymentMetadata,
} from "./pesaswap-payments";

// --- Types ---

export type PaymentState =
  | "idle"
  | "ready"
  | "confirming"
  | "processing"
  | "success"
  | "error";

export type UsePaymentOptions = {
  amount: number;
  currency?: string;
  merchant: { name: string; till: string; id?: string };
  flow: "tapgo" | "table" | "invoice" | "quick_charge";
  table?: { number: number; server: string; orderId?: string };
  items?: Array<{
    name: string;
    qty: number;
    price: number;
    category?: string;
  }>;
  split?: {
    type: "full" | "equal" | "custom" | "by_item";
    totalParties?: number;
    index?: number;
  };
  tip?: { amount: number; recipient: string };
  qrScannedAt?: string;
};

export type PaymentResult = {
  state: PaymentState;
  paymentId: string | null;
  error: string | null;
  elapsedMs: number;
  pay: (phone: string, name?: string) => Promise<void>;
  retry: () => void;
  reset: () => void;
};

// --- Hook ---

/**
 * Unified payment hook for all payment flows.
 * Manages the full payment lifecycle: create → confirm → poll → success/error.
 *
 * @example
 * const payment = usePayment({
 *   amount: 2450,
 *   merchant: { name: "Naivas", till: "247365" },
 *   flow: "tapgo",
 * });
 *
 * // Trigger payment
 * await payment.pay("0722123456");
 *
 * // Check state
 * if (payment.state === "success") { ... }
 */
export function usePayment(options: UsePaymentOptions): PaymentResult {
  const [state, setState] = useState<PaymentState>("idle");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Preload HyperLoader
  useEffect(() => {
    loadHyperLoader().catch(() => {});
  }, []);

  const pay = useCallback(
    async (phone: string, name?: string) => {
      setState("processing");
      setError(null);
      startTimeRef.current = Date.now();

      const metadata = buildPaymentMetadata({
        merchant: options.merchant,
        flow: options.flow,
        customer: { phone, name },
        table: options.table,
        items: options.items,
        split: options.split,
        tip: options.tip,
        qrScannedAt: options.qrScannedAt,
      });

      const result = await executePayment({
        amount: options.amount,
        currency: options.currency || "KES",
        metadata,
        phone,
        onStatusChange: (status: PaymentStatus) => {
          if (status === "processing") setState("processing");
        },
      });

      setElapsedMs(Date.now() - startTimeRef.current);

      if (result.success) {
        setPaymentId(result.payment_id || null);
        setState("success");
      } else {
        setError(result.error || "Payment failed. Please try again.");
        setState("error");
      }
    },
    [options],
  );

  const retry = useCallback(() => {
    setError(null);
    setState("ready");
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setPaymentId(null);
    setError(null);
    setElapsedMs(0);
  }, []);

  return { state, paymentId, error, elapsedMs, pay, retry, reset };
}

// --- Metadata builder shorthand for common flows ---

export function buildTapGoMetadata(params: {
  merchant: string;
  till: string;
  phone: string;
}): PaymentMetadata {
  return buildPaymentMetadata({
    merchant: { name: params.merchant, till: params.till },
    flow: "tapgo",
    customer: { phone: params.phone },
  });
}

export function buildTableMetadata(params: {
  merchant: string;
  till: string;
  phone: string;
  tableNumber: number;
  server: string;
  items: Array<{ name: string; qty: number; price: number; category?: string }>;
  splitType: "full" | "equal" | "custom" | "by_item";
  splitCount?: number;
  tipAmount?: number;
  qrScannedAt?: string;
}): PaymentMetadata {
  return buildPaymentMetadata({
    merchant: { name: params.merchant, till: params.till },
    flow: "table",
    customer: { phone: params.phone },
    table: { number: params.tableNumber, server: params.server },
    items: params.items,
    split: {
      type: params.splitType,
      totalParties: params.splitCount || 1,
      index: 1,
    },
    tip: params.tipAmount
      ? { amount: params.tipAmount, recipient: params.server }
      : undefined,
    qrScannedAt: params.qrScannedAt,
  });
}
