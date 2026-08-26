import { describe, expect, it } from "vitest";
import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  fromMinorUnits,
  isRepresentable,
  isSupportedCurrency,
  minorUnitExponent,
  minorUnitFactor,
  normalizeCurrency,
  toMinorUnits,
} from "../../src/lib/currency";
import { validateInvoiceInput } from "../../src/lib/invoice-validation";

describe("the supported currency set", () => {
  it("accepts exactly the agreed currencies", () => {
    expect([...SUPPORTED_CURRENCIES]).toEqual([
      "KES",
      "USD",
      "EUR",
      "GBP",
      "UGX",
      "TZS",
    ]);
  });

  it("still defaults to KES", () => {
    expect(DEFAULT_CURRENCY).toBe("KES");
    expect(normalizeCurrency(undefined)).toBe("KES");
    expect(normalizeCurrency("")).toBe("KES");
    expect(normalizeCurrency(null)).toBe("KES");
  });

  it("normalises case and whitespace", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("gbp")).toBe("GBP");
  });

  it("rejects anything outside the set rather than guessing", () => {
    expect(normalizeCurrency("ZAR")).toBeNull();
    expect(normalizeCurrency("BTC")).toBeNull();
    expect(isSupportedCurrency("NGN")).toBe(false);
  });
});

describe("zero-decimal currencies are not treated as cents", () => {
  it("knows UGX and TZS have no minor unit", () => {
    expect(minorUnitExponent("UGX")).toBe(0);
    expect(minorUnitExponent("TZS")).toBe(0);
    expect(minorUnitFactor("UGX")).toBe(1);
    expect(minorUnitFactor("TZS")).toBe(1);
  });

  it("keeps two decimals for KES, USD, EUR and GBP", () => {
    for (const c of ["KES", "USD", "EUR", "GBP"] as const) {
      expect(minorUnitExponent(c)).toBe(2);
      expect(minorUnitFactor(c)).toBe(100);
    }
  });

  it("does NOT inflate a UGX amount a hundredfold", () => {
    // The bug this exists to prevent: UGX 5,000 is 5,000 minor units, not
    // 500,000. Using the KES ×100 constant would overstate it 100x in the GL.
    expect(toMinorUnits(5000, "UGX")).toBe(5000);
    expect(toMinorUnits(5000, "KES")).toBe(500_000);
  });

  it("round-trips major → minor → major for every currency", () => {
    for (const c of SUPPORTED_CURRENCIES) {
      const major = c === "UGX" || c === "TZS" ? 12_345 : 1234.56;
      expect(fromMinorUnits(toMinorUnits(major, c), c)).toBeCloseTo(major, 8);
    }
  });

  it("refuses fractional amounts in a zero-decimal currency", () => {
    expect(isRepresentable(100.5, "UGX")).toBe(false);
    expect(isRepresentable(100.5, "KES")).toBe(true);
    expect(isRepresentable(100.005, "KES")).toBe(false);
  });
});

describe("invoice validation across currencies", () => {
  const base = { lineItems: [{ description: "Item", qty: 1, price: 100 }] };

  it("accepts every supported currency", () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      const result = validateInvoiceInput({ ...base, currency });
      expect(result, currency).not.toHaveProperty("error");
      expect((result as { currency: string }).currency).toBe(currency);
    }
  });

  it("defaults to KES when none is supplied", () => {
    const result = validateInvoiceInput(base);
    expect((result as { currency: string }).currency).toBe("KES");
  });

  it("names the supported set when rejecting an unknown currency", () => {
    const result = validateInvoiceInput({ ...base, currency: "ZAR" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/KES, USD, EUR, GBP, UGX, TZS/);
  });

  it("rejects sub-shilling UGX prices with a currency-specific message", () => {
    const result = validateInvoiceInput({
      currency: "UGX",
      lineItems: [{ description: "Item", qty: 1, price: 100.5 }],
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/UGX amounts must be whole numbers/);
  });

  it("still allows two decimals in USD", () => {
    const result = validateInvoiceInput({
      currency: "USD",
      lineItems: [{ description: "Item", qty: 1, price: 100.5 }],
    });
    expect(result).not.toHaveProperty("error");
  });

  it("no longer claims only KES is supported", () => {
    const result = validateInvoiceInput({ ...base, currency: "USD" });
    expect(JSON.stringify(result)).not.toMatch(/Only KES/);
  });
});
