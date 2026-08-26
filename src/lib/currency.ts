// Which currencies the platform accepts, and how many minor units each has.
//
// The ledger stores minor units as integers. KES/USD/EUR/GBP have two decimal
// places, but UGX and TZS have ZERO — their minor unit is the shilling itself.
// Multiplying a UGX amount by 100 (the constant this codebase used everywhere
// when KES was the only currency) would inflate it a hundredfold, so every
// major↔minor conversion has to go through the currency's own exponent.
//
// Balances are held per currency and never summed across them: the accounting
// reports each take a `currency` and filter on it. There is deliberately no FX
// conversion or revaluation here — that needs a rate table with effective
// dating and a gain/loss policy, which is a separate piece of work.

export const SUPPORTED_CURRENCIES = [
  "KES",
  "USD",
  "EUR",
  "GBP",
  "UGX",
  "TZS",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = "KES";

const MINOR_UNIT_EXPONENT: Readonly<Record<SupportedCurrency, number>> = {
  KES: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  UGX: 0,
  TZS: 0,
};

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return (
    typeof value === "string" &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value.toUpperCase())
  );
}

/** Uppercase + validate. Blank falls back to the default; unknown returns null. */
export function normalizeCurrency(value: unknown): SupportedCurrency | null {
  if (value === undefined || value === null) return DEFAULT_CURRENCY;
  const text = String(value).trim().toUpperCase();
  if (!text) return DEFAULT_CURRENCY;
  return isSupportedCurrency(text) ? (text as SupportedCurrency) : null;
}

export function minorUnitExponent(currency: SupportedCurrency): number {
  return MINOR_UNIT_EXPONENT[currency];
}

/** Minor units per major unit: 100 for KES/USD/EUR/GBP, 1 for UGX/TZS. */
export function minorUnitFactor(currency: SupportedCurrency): number {
  return 10 ** MINOR_UNIT_EXPONENT[currency];
}

export function toMinorUnits(
  amountMajor: number,
  currency: SupportedCurrency,
): number {
  return Math.round(amountMajor * minorUnitFactor(currency));
}

export function fromMinorUnits(
  amountMinor: number,
  currency: SupportedCurrency,
): number {
  return amountMinor / minorUnitFactor(currency);
}

/** True when the amount can be represented exactly — no sub-cent, no sub-shilling. */
export function isRepresentable(
  amountMajor: number,
  currency: SupportedCurrency,
): boolean {
  if (!Number.isFinite(amountMajor)) return false;
  const scaled = amountMajor * minorUnitFactor(currency);
  return Math.abs(scaled - Math.round(scaled)) <= 1e-8;
}

export function currencyLabel(currency: SupportedCurrency): string {
  return currency;
}

// Which collection rails can actually take money in each currency. Capture and
// collection are different problems: an invoice may be RAISED in any supported
// currency, but it can only be PAID where a rail exists. M-Pesa STK is KES-only,
// so today every other currency has no rail and a pay link cannot be issued.
// Add card here when the card rail is wired — nothing else needs to change.
const COLLECTION_RAILS: Readonly<Record<SupportedCurrency, readonly string[]>> = {
  KES: ["m_pesa_express"],
  USD: [],
  EUR: [],
  GBP: [],
  UGX: [],
  TZS: [],
};

export function collectionMethodsFor(
  currency: SupportedCurrency,
): readonly string[] {
  return COLLECTION_RAILS[currency];
}

export function isCollectable(currency: SupportedCurrency): boolean {
  return COLLECTION_RAILS[currency].length > 0;
}
