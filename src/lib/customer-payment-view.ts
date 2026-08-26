export type CustomerPaymentSourceRow = {
  id: unknown;
  amount: unknown;
  currency: unknown;
  status: unknown;
  kind: unknown;
  reference: unknown;
  provider_ref: unknown;
  tip_amount: unknown;
  metadata: unknown;
  refunded_amount: unknown;
  created_at: unknown;
};

export type CustomerPaymentView = {
  id: string;
  amount: number;
  principalAmount: number;
  tipAmount: number;
  currency: string;
  status: string;
  kind: string;
  reference: string | null;
  providerRef: string | null;
  flowType: string | null;
  sourceId: string | null;
  invoiceNumber: string | null;
  errorMessage: string | null;
  refundedAmount: number;
  refundOf: string | null;
  refundReason: string | null;
  canRequestRefund: boolean;
  createdAt: string;
};

const REFUND_REQUEST_STATUSES = new Set([
  "succeeded",
  "paid",
  "captured",
  "partially_refunded",
]);

function optionalText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

export function toCustomerPaymentView(
  row: CustomerPaymentSourceRow,
): CustomerPaymentView {
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const amount = Math.max(0, Math.round(Number(row.amount) || 0));
  const tipAmount = Math.min(
    amount,
    Math.max(0, Math.round(Number(row.tip_amount) || 0)),
  );
  const refundedAmount = Math.max(
    0,
    Math.round(Number(row.refunded_amount) || 0),
  );
  const status = String(row.status ?? "unknown");
  const kind = String(row.kind ?? "payment");
  const created = new Date(row.created_at as string | number | Date);

  return {
    id: String(row.id),
    amount,
    principalAmount: amount - tipAmount,
    tipAmount,
    currency: String(row.currency ?? "KES"),
    status,
    kind,
    reference: optionalText(row.reference),
    providerRef: optionalText(row.provider_ref),
    flowType: optionalText(metadata.flow_type, 80),
    sourceId: optionalText(metadata.source_id, 200),
    invoiceNumber: optionalText(metadata.invoice_number, 100),
    errorMessage: optionalText(metadata.error_message),
    refundedAmount,
    refundOf: optionalText(metadata.refund_of, 200),
    refundReason: optionalText(metadata.refund_reason),
    canRequestRefund:
      kind !== "refund" &&
      REFUND_REQUEST_STATUSES.has(status) &&
      refundedAmount < amount,
    createdAt: Number.isNaN(created.getTime())
      ? String(row.created_at ?? "")
      : created.toISOString(),
  };
}
