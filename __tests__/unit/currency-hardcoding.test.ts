import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  collectionMethodsFor,
  isCollectable,
  SUPPORTED_CURRENCIES,
} from "../../src/lib/currency";

// Enabling six currencies turned several "KES is the only currency" shortcuts
// into real bugs: a UGX invoice would have had its balance multiplied by 100 and
// a payment intent minted in KES.

const holds = readFileSync("src/lib/invoice-payment-holds.ts", "utf8");
const accounting = readFileSync("src/lib/accounting.ts", "utf8");
const payLinks = readFileSync("src/lib/pay-links.ts", "utf8");
const paymentIntents = readFileSync("src/lib/payment-intents.ts", "utf8");

describe("capture and collection are separated", () => {
  it("only KES has a collection rail today", () => {
    expect(isCollectable("KES")).toBe(true);
    expect(collectionMethodsFor("KES")).toContain("m_pesa_express");
    for (const c of SUPPORTED_CURRENCIES.filter((x) => x !== "KES")) {
      expect(isCollectable(c), c).toBe(false);
      expect(collectionMethodsFor(c), c).toHaveLength(0);
    }
  });

  it("refuses a pay link for a currency with no rail, and says why", () => {
    expect(holds).toMatch(/no payment rail is available for \$\{currency\} yet/);
  });
});

describe("the invoice payment hold is no longer KES-only", () => {
  it("mints the intent in the invoice's own currency", () => {
    expect(holds).toMatch(/\$\{availableMinor\}, \$\{currency\}, 'invoice'/);
    expect(holds).not.toMatch(/\$\{availableMinor\}, 'KES', 'invoice'/);
  });

  it("takes the payment method from the rail table, not a literal", () => {
    expect(holds).toMatch(/const \[method\] = collectionMethodsFor\(currency\)/);
    expect(holds).not.toMatch(/'m_pesa_express', 0,/);
  });

  it("converts the balance with the currency's own exponent", () => {
    expect(holds).toMatch(/toMinorUnits\(balanceMajor, currency\)/);
    expect(holds).not.toMatch(/Math\.round\(balanceMajor \* 100\)/);
  });

  it("returns the real currency rather than asserting KES", () => {
    expect(holds).not.toMatch(/currency: "KES"/);
  });

  it("keeps the pay-link response currency-aware instead of dividing by 100 unconditionally", () => {
    expect(payLinks).toMatch(/fromMinorUnits\(amountMinor, currency\)/);
    expect(payLinks).not.toMatch(/amountMinor \/ 100/);
  });

  it("normalizes payment intent currencies instead of defaulting to KES", () => {
    expect(paymentIntents).toMatch(/normalizeCurrency\(input\.currency\)/);
    expect(paymentIntents).not.toMatch(/input\.currency \?\? "KES"/);
  });
});

describe("the audit hash chain covers every currency", () => {
  it("takes a currency instead of hardcoding KES", () => {
    expect(accounting).toMatch(
      /currency: SupportedCurrency = DEFAULT_CURRENCY,/,
    );
  });

  it("has no KES literal left in the checkpoint queries", () => {
    const fn = accounting.slice(
      accounting.indexOf("export async function createAuditCheckpointInTransaction"),
    );
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).not.toMatch(/'KES'/);
    expect(body).toMatch(/currency = \$\{currency\}/);
  });
});
