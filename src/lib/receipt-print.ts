// A1.4 — the paper-receipt fallback.
//
// Sunday's Digital Bill article (10722442) ends with: "If you absolutely require
// a printed receipt, our team will be happy to provide one upon request." That
// sentence is the whole feature — it is the STAFF who produce it, on request,
// from the check they are already looking at.
//
// This module composes the printable document from the authoritative order. It
// deliberately does no formatting decisions the server should not own (paper
// width, fonts, logos): it returns numbers and labels, and the print stylesheet
// on the client turns them into a receipt. Keeping it pure means the totals on
// a printed receipt are the same totals that were charged, and a test can say so.

export type PrintableLine = {
  name: string;
  qty: number;
  unitMinor: number;
  totalMinor: number;
  notes: string | null;
};

export type PrintablePayment = {
  id: string;
  amountMinor: number;
  tipMinor: number;
  method: string | null;
  reference: string | null;
  paidAt: string | null;
};

export type PrintableReceipt = {
  venueName: string;
  orderId: string;
  tableLabel: string | null;
  currency: string;
  lines: PrintableLine[];
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  totalMinor: number;
  paidMinor: number;
  tipMinor: number;
  remainingMinor: number;
  settled: boolean;
  issuedAt: string;
  /**
   * Every printed receipt names the payment ids behind it. A printed number
   * that cannot be walked back to a payment id is not evidence.
   */
  payments: PrintablePayment[];
};

function int(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export type PrintableInput = {
  venueName: string;
  orderId: string;
  tableLabel?: string | null;
  currency?: string | null;
  totalMinor: unknown;
  discountMinor?: unknown;
  serviceChargeMinor?: unknown;
  paidAt?: string | null;
  issuedAt: string;
  items: ReadonlyArray<{
    name?: unknown;
    qty?: unknown;
    price?: unknown;
    notes?: unknown;
  }>;
  payments: ReadonlyArray<{
    id?: unknown;
    amount?: unknown;
    tip_amount?: unknown;
    provider?: unknown;
    reference?: unknown;
    created_at?: unknown;
  }>;
};

export function buildPrintableReceipt(input: PrintableInput): PrintableReceipt {
  const lines: PrintableLine[] = input.items.map((item) => {
    const qty = Math.max(1, int(item.qty) || 1);
    const unitMinor = int(item.price);
    return {
      name: String(item.name ?? "Item"),
      qty,
      unitMinor,
      totalMinor: unitMinor * qty,
      notes: item.notes ? String(item.notes) : null,
    };
  });

  const payments: PrintablePayment[] = input.payments.map((p) => ({
    id: String(p.id ?? ""),
    amountMinor: int(p.amount),
    tipMinor: int(p.tip_amount),
    method: p.provider ? String(p.provider) : null,
    reference: p.reference ? String(p.reference) : null,
    paidAt: p.created_at ? String(p.created_at) : null,
  }));

  const subtotalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  const totalMinor = Math.max(0, int(input.totalMinor));
  const tipMinor = payments.reduce((sum, p) => sum + p.tipMinor, 0);
  const paidMinor = payments.reduce(
    (sum, p) => sum + Math.max(0, p.amountMinor - p.tipMinor),
    0,
  );
  const remainingMinor = Math.max(0, totalMinor - paidMinor);

  return {
    venueName: input.venueName,
    orderId: input.orderId,
    tableLabel: input.tableLabel ?? null,
    currency: String(input.currency ?? "KES"),
    lines,
    subtotalMinor,
    discountMinor: Math.max(0, int(input.discountMinor)),
    serviceChargeMinor: Math.max(0, int(input.serviceChargeMinor)),
    totalMinor,
    paidMinor,
    tipMinor,
    remainingMinor,
    settled: Boolean(input.paidAt) || remainingMinor <= 0,
    issuedAt: input.issuedAt,
    payments,
  };
}
