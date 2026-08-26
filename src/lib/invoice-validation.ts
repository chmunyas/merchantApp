import type { LineItem } from "@/lib/invoices";
import {
  SUPPORTED_CURRENCIES,
  isRepresentable,
  minorUnitExponent,
  normalizeCurrency,
  toMinorUnits,
  type SupportedCurrency,
} from "@/lib/currency";

const MAX_MAJOR_AMOUNT = 10_000_000_000;

export type ValidatedInvoice = {
  items: LineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
  currency: SupportedCurrency;
  dueDate: string | null;
};

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateInvoiceInput(input: {
  amount?: unknown;
  currency?: unknown;
  lineItems?: LineItem[];
  taxRate?: unknown;
  dueDate?: unknown;
  expectedTotal?: unknown;
}): ValidatedInvoice | { error: string } {
  const currency = normalizeCurrency(input.currency);
  if (currency === null) {
    return {
      error: `Unsupported currency. Supported: ${SUPPORTED_CURRENCIES.join(", ")}.`,
    };
  }
  // UGX and TZS have no minor unit, so "two decimal places" is wrong for them.
  const decimals = minorUnitExponent(currency);
  const precisionError = decimals === 0
    ? `${currency} amounts must be whole numbers.`
    : `${currency} amounts support at most ${decimals} decimal places.`;

  const rawItems = Array.isArray(input.lineItems) ? input.lineItems : [];
  const items: LineItem[] = [];
  for (const raw of rawItems) {
    const description = String(raw?.description ?? "").trim();
    const qty = finite(raw?.qty);
    const price = finite(raw?.price);
    if (!description || description.length > 500) return { error: "Each line requires a bounded description." };
    if (qty === null || !Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) {
      return { error: "Each line quantity must be a positive integer." };
    }
    if (price === null || price <= 0 || price > MAX_MAJOR_AMOUNT) {
      return { error: "Each line price must be finite and positive." };
    }
    if (!isRepresentable(price, currency)) {
      return { error: precisionError };
    }
    items.push({ description, qty, price });
  }

  const fallbackAmount = finite(input.amount);
  const subtotal = items.length > 0
    ? items.reduce((sum, item) => sum + item.qty * item.price, 0)
    : fallbackAmount ?? 0;
  if (!Number.isFinite(subtotal) || subtotal <= 0 || subtotal > MAX_MAJOR_AMOUNT) {
    return { error: "Invoice subtotal must be finite and positive." };
  }
  if (!isRepresentable(subtotal, currency)) {
    return { error: precisionError };
  }
  const taxRate = finite(input.taxRate ?? 0);
  if (taxRate === null || taxRate < 0 || taxRate > 100) {
    return { error: "Tax rate must be between 0 and 100." };
  }
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  const amount = subtotal + taxAmount;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toMinorUnits(amount, currency))) {
    return { error: "Invoice total is outside the supported range." };
  }
  const expected = input.expectedTotal == null ? null : finite(input.expectedTotal);
  if (expected !== null && Math.abs(expected - amount) > 0.005) {
    return { error: "Invoice total does not match its line and tax calculation." };
  }
  const dueDate = input.dueDate == null || input.dueDate === ""
    ? null
    : String(input.dueDate);
  if (dueDate && (!validCalendarDate(dueDate) || dueDate < new Date().toISOString().slice(0, 10))) {
    return { error: "Due date must be a valid date on or after today." };
  }
  return { items, subtotal, taxRate, taxAmount, amount, currency, dueDate };
}