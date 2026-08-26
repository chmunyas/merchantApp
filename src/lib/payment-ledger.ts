export type PaymentLedgerRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  kind: string;
  reference: string | null;
  providerRef: string | null;
  tipAmount: number;
  initiator: string;
  customerPhone: string | null;
  customerName: string | null;
  flowType: string | null;
  sourceId: string | null;
  invoiceNumber: string | null;
  errorMessage: string | null;
  refundedAmount: number;
  refundOf: string | null;
  refundReason: string | null;
  createdAt: string;
};

export type PaymentLedgerFilter =
  | "all"
  | "settled"
  | "processing"
  | "failed"
  | "refunded";

export const SETTLED_PAYMENT_STATUSES = [
  "succeeded",
  "paid",
  "captured",
] as const;

const CAPTURED_PAYMENT_STATUSES = [
  ...SETTLED_PAYMENT_STATUSES,
  "partially_refunded",
  "refunded",
] as const;

export function isSettledPayment(payment: PaymentLedgerRow): boolean {
  return (
    payment.kind !== "refund" &&
    CAPTURED_PAYMENT_STATUSES.includes(
      payment.status as (typeof CAPTURED_PAYMENT_STATUSES)[number],
    )
  );
}

export function paymentMatchesFilter(
  payment: PaymentLedgerRow,
  filter: PaymentLedgerFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "settled") {
    return (
      payment.kind !== "refund" &&
      SETTLED_PAYMENT_STATUSES.includes(
        payment.status as (typeof SETTLED_PAYMENT_STATUSES)[number],
      )
    );
  }
  if (filter === "processing") return payment.status === "processing";
  if (filter === "failed") {
    return ["failed", "cancelled"].includes(payment.status);
  }
  return (
    payment.kind === "refund" ||
    ["refunded", "partially_refunded"].includes(payment.status) ||
    payment.refundedAmount > 0
  );
}

export function paymentStatusLabel(status: string): string {
  if (status === "partially_refunded") return "Partially refunded";
  if (status === "refunded") return "Refunded";
  if (SETTLED_PAYMENT_STATUSES.includes(status as never)) return "Settled";
  if (status === "processing") return "Processing";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return status.replace(/_/g, " ");
}

export function paymentFlowLabel(
  payment: Pick<PaymentLedgerRow, "kind" | "invoiceNumber" | "flowType">,
): string {
  if (payment.kind === "refund") return "Refund";
  if (payment.invoiceNumber) return `Invoice ${payment.invoiceNumber}`;
  const flow = payment.flowType ?? payment.kind;
  if (flow === "tapgo") return "Tap & Go";
  if (flow === "table") return "Table payment";
  if (flow === "quick_charge") return "Quick charge";
  if (flow === "invoice") return "Invoice payment";
  return flow.replace(/_/g, " ");
}

export function netSettledAmount(payments: PaymentLedgerRow[]): number {
  return payments
    .filter(isSettledPayment)
    .reduce(
      (total, payment) =>
        total + Math.max(0, payment.amount - payment.refundedAmount),
      0,
    );
}
