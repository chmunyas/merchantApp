// Till arithmetic. Pure so a disputed receipt can be recomputed exactly.
//
// Money is minor units (integers) everywhere. Quantity is the only decimal —
// a shop sells 0.75 kg — so the one rounding decision in the whole file is
// qty x unit price, and it is made once, here.

export type SaleLineDraft = {
  itemId?: string | null;
  name: string;
  qty: number;
  unitPriceMinor: number;
  unitCostMinor?: number;
};

export type SaleLine = {
  itemId: string | null;
  name: string;
  qty: number;
  unitPriceMinor: number;
  unitCostMinor: number;
  totalMinor: number;
};

export type SaleTotals = {
  lines: SaleLine[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  costMinor: number;
  marginMinor: number;
};

/** Quantity carries three decimals (grams, litres); money never does. */
export function normalizeQty(value: unknown): number {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.round(qty * 1000) / 1000;
}

export function lineTotalMinor(qty: number, unitPriceMinor: number): number {
  if (!Number.isFinite(qty) || !Number.isFinite(unitPriceMinor)) return 0;
  return Math.max(0, Math.round(qty * unitPriceMinor));
}

export function normalizeLine(draft: SaleLineDraft): SaleLine | null {
  const name = String(draft.name ?? "").trim();
  if (!name) return null;
  const qty = normalizeQty(draft.qty);
  if (qty <= 0) return null;
  const unitPriceMinor = Math.max(0, Math.round(Number(draft.unitPriceMinor) || 0));
  const unitCostMinor = Math.max(0, Math.round(Number(draft.unitCostMinor) || 0));
  return {
    itemId: draft.itemId ?? null,
    name: name.slice(0, 200),
    qty,
    unitPriceMinor,
    unitCostMinor,
    totalMinor: lineTotalMinor(qty, unitPriceMinor),
  };
}

/**
 * A discount larger than the basket clamps to the basket rather than handing
 * the customer money — a till must never produce a negative sale.
 */
export function computeSaleTotals(
  drafts: readonly SaleLineDraft[],
  discountMinorInput = 0,
): SaleTotals {
  const lines: SaleLine[] = [];
  for (const draft of drafts) {
    const line = normalizeLine(draft);
    if (line) lines.push(line);
  }
  const subtotalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  const costMinor = lines.reduce(
    (sum, line) => sum + lineTotalMinor(line.qty, line.unitCostMinor),
    0,
  );
  const requested = Math.max(0, Math.round(Number(discountMinorInput) || 0));
  const discountMinor = Math.min(requested, subtotalMinor);
  const totalMinor = subtotalMinor - discountMinor;
  return {
    lines,
    subtotalMinor,
    discountMinor,
    totalMinor,
    costMinor,
    marginMinor: totalMinor - costMinor,
  };
}

export const RETAIL_PAYMENT_METHODS = [
  "cash",
  "mpesa",
  "card",
  "credit",
  "bnpl",
] as const;

export type RetailPaymentMethod = (typeof RETAIL_PAYMENT_METHODS)[number];

export function isRetailPaymentMethod(
  value: unknown,
): value is RetailPaymentMethod {
  return (
    typeof value === "string" &&
    (RETAIL_PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

export type SaleRejection = "empty" | "method" | "no_priced_line";

export function validateSale(
  totals: SaleTotals,
  method: unknown,
): SaleRejection | null {
  if (totals.lines.length === 0) return "empty";
  if (!isRetailPaymentMethod(method)) return "method";
  // A basket of entirely zero-priced lines is a scanning mistake, not a sale.
  if (totals.subtotalMinor <= 0) return "no_priced_line";
  return null;
}

/** Cash handed over minus what is owed. Never negative. */
export function changeDueMinor(
  totalMinor: number,
  tenderedMinor: number,
): number {
  return Math.max(0, Math.round(tenderedMinor) - Math.round(totalMinor));
}
