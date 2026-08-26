import { describe, expect, it } from "vitest";

import {
  changeDueMinor,
  computeSaleTotals,
  isRetailPaymentMethod,
  lineTotalMinor,
  normalizeLine,
  normalizeQty,
  validateSale,
} from "../../src/lib/retail-sales";

const line = (over: Record<string, unknown> = {}) => ({
  name: "Maize flour 2kg",
  qty: 1,
  unitPriceMinor: 18000,
  unitCostMinor: 14000,
  ...over,
});

describe("quantity", () => {
  it("keeps three decimals for weighed goods", () => {
    expect(normalizeQty(0.756)).toBe(0.756);
    expect(normalizeQty(1.23456)).toBe(1.235);
  });

  it("treats a nonsense quantity as nothing to sell", () => {
    expect(normalizeQty(0)).toBe(0);
    expect(normalizeQty(-2)).toBe(0);
    expect(normalizeQty("abc")).toBe(0);
  });
});

describe("line totals", () => {
  it("rounds a weighed line to whole cents once", () => {
    expect(lineTotalMinor(0.756, 18000)).toBe(13608);
  });

  it("multiplies a whole-unit line exactly", () => {
    expect(lineTotalMinor(3, 250)).toBe(750);
  });

  it("drops a line with no name or no quantity", () => {
    expect(normalizeLine(line({ name: "  " }))).toBeNull();
    expect(normalizeLine(line({ qty: 0 }))).toBeNull();
  });

  it("never produces a negative price from bad input", () => {
    expect(normalizeLine(line({ unitPriceMinor: -500 }))?.unitPriceMinor).toBe(0);
  });
});

describe("sale totals", () => {
  it("sums the basket and derives margin from cost snapshots", () => {
    const totals = computeSaleTotals([
      line({ qty: 2, unitPriceMinor: 18000, unitCostMinor: 14000 }),
      line({ name: "Sugar 1kg", qty: 1, unitPriceMinor: 22000, unitCostMinor: 17000 }),
    ]);
    expect(totals.subtotalMinor).toBe(58000);
    expect(totals.costMinor).toBe(45000);
    expect(totals.totalMinor).toBe(58000);
    expect(totals.marginMinor).toBe(13000);
  });

  it("applies a discount without ever going negative", () => {
    const totals = computeSaleTotals([line()], 999999);
    expect(totals.discountMinor).toBe(18000);
    expect(totals.totalMinor).toBe(0);
  });

  it("ignores a negative discount rather than inflating the sale", () => {
    const totals = computeSaleTotals([line()], -5000);
    expect(totals.discountMinor).toBe(0);
    expect(totals.totalMinor).toBe(18000);
  });

  it("silently drops unsellable lines but keeps the rest", () => {
    const totals = computeSaleTotals([line(), line({ qty: 0 }), line({ name: "" })]);
    expect(totals.lines).toHaveLength(1);
  });

  it("reports a loss honestly when sold below cost", () => {
    const totals = computeSaleTotals([
      line({ unitPriceMinor: 10000, unitCostMinor: 14000 }),
    ]);
    expect(totals.marginMinor).toBe(-4000);
  });
});

describe("validation", () => {
  it("rejects an empty basket", () => {
    expect(validateSale(computeSaleTotals([]), "cash")).toBe("empty");
  });

  it("rejects an unknown payment method", () => {
    expect(validateSale(computeSaleTotals([line()]), "bitcoin")).toBe("method");
  });

  it("rejects a basket that is entirely zero-priced", () => {
    const totals = computeSaleTotals([line({ unitPriceMinor: 0 })]);
    expect(validateSale(totals, "cash")).toBe("no_priced_line");
  });

  it("accepts a valid cash sale", () => {
    expect(validateSale(computeSaleTotals([line()]), "cash")).toBeNull();
  });

  it("knows the supported tenders", () => {
    expect(isRetailPaymentMethod("mpesa")).toBe(true);
    expect(isRetailPaymentMethod("cheque")).toBe(false);
  });
});

describe("change", () => {
  it("returns what the customer is owed", () => {
    expect(changeDueMinor(18000, 20000)).toBe(2000);
  });

  it("never reports change when underpaid", () => {
    expect(changeDueMinor(18000, 15000)).toBe(0);
  });
});
