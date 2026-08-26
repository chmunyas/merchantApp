import { describe, it, expect } from "vitest";

import {
  bandFor,
  includedGratuityPct,
  tipTierNotice,
  tipTiersFor,
} from "../../src/lib/tip-tiers";

// A bill whose PRE-gratuity base is `base` with `pct`% auto-gratuity on top.
const billWith = (base: number, pct: number) => ({
  total: base + (base * pct) / 100,
  included: (base * pct) / 100,
});

describe("includedGratuityPct", () => {
  it("is 0 when the bill carries no service charge", () => {
    expect(includedGratuityPct(1000, 0)).toBe(0);
  });

  it("is measured against the pre-gratuity base, not the bill total", () => {
    // 1000 food + 120 auto-gratuity = 12%, not 120/1120 = 10.7%.
    expect(includedGratuityPct(1120, 120)).toBeCloseTo(12, 6);
  });

  it("is infinite for a gratuity-only bill", () => {
    expect(includedGratuityPct(500, 500)).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores negative and non-numeric input", () => {
    expect(includedGratuityPct(1000, -50)).toBe(0);
    expect(includedGratuityPct(1000, Number.NaN)).toBe(0);
    expect(includedGratuityPct(Number.NaN, 100)).toBe(0);
  });

  it("never lets the included gratuity exceed the bill", () => {
    expect(includedGratuityPct(1000, 5000)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("bandFor", () => {
  it("keeps standard options below 10%", () => {
    expect(bandFor(0)).toBe("standard");
    expect(bandFor(9.99)).toBe("standard");
  });

  it("pro-rates from exactly 10% up to and including exactly 17%", () => {
    expect(bandFor(10)).toBe("prorated");
    expect(bandFor(12)).toBe("prorated");
    expect(bandFor(17)).toBe("prorated");
  });

  it("reduces only above 17%", () => {
    expect(bandFor(17.01)).toBe("reduced");
    expect(bandFor(25)).toBe("reduced");
    expect(bandFor(Number.POSITIVE_INFINITY)).toBe("reduced");
  });
});

describe("tipTiersFor — standard band (< 10% included)", () => {
  it("shows 20/23/25% when nothing is included", () => {
    const plan = tipTiersFor(1000, 0);
    expect(plan.band).toBe("standard");
    expect(plan.includedPct).toBe(0);
    expect(plan.base).toBe(1000);
    expect(plan.tiers.map((t) => t.pct)).toEqual([20, 23, 25]);
    expect(plan.tiers.map((t) => t.amount)).toEqual([200, 230, 250]);
  });

  it("shows 20/23/25% when the included gratuity is unknown", () => {
    expect(tipTiersFor(1000).tiers.map((t) => t.pct)).toEqual([20, 23, 25]);
  });

  it("still shows standard options just under the 10% boundary", () => {
    const { total, included } = billWith(1000, 9.9);
    const plan = tipTiersFor(total, included);
    expect(plan.band).toBe("standard");
    expect(plan.tiers.map((t) => t.pct)).toEqual([20, 23, 25]);
  });

  it("charges the standard percentages against the pre-gratuity base", () => {
    const { total, included } = billWith(1000, 5);
    const plan = tipTiersFor(total, included);
    expect(plan.base).toBe(1000);
    expect(plan.tiers.map((t) => t.amount)).toEqual([200, 230, 250]);
  });
});

describe("tipTiersFor — pro-rated band (10–17% included)", () => {
  it("pro-rates at exactly 10%", () => {
    const { total, included } = billWith(1000, 10);
    const plan = tipTiersFor(total, included);
    expect(plan.band).toBe("prorated");
    expect(plan.includedPct).toBe(10);
    expect(plan.tiers.map((t) => t.pct)).toEqual([10, 13, 15]);
    expect(plan.tiers.map((t) => t.combinedPct)).toEqual([20, 23, 25]);
  });

  it("pro-rates the documented 12% example", () => {
    const { total, included } = billWith(1000, 12);
    const plan = tipTiersFor(total, included);
    expect(plan.band).toBe("prorated");
    expect(plan.tiers.map((t) => t.pct)).toEqual([8, 11, 13]);
    expect(plan.tiers.map((t) => t.amount)).toEqual([80, 110, 130]);
  });

  it("pro-rates at exactly 17%", () => {
    const { total, included } = billWith(1000, 17);
    const plan = tipTiersFor(total, included);
    expect(plan.band).toBe("prorated");
    expect(plan.tiers.map((t) => t.pct)).toEqual([3, 6, 8]);
    expect(plan.tiers.map((t) => t.combinedPct)).toEqual([20, 23, 25]);
  });

  it("always lands the combined gratuity in the 20–25% window", () => {
    for (let pct = 10; pct <= 17; pct += 0.5) {
      const { total, included } = billWith(1000, pct);
      const plan = tipTiersFor(total, included);
      expect(plan.band).toBe("prorated");
      for (const tier of plan.tiers) {
        expect(tier.combinedPct).toBeGreaterThanOrEqual(19.5);
        expect(tier.combinedPct).toBeLessThanOrEqual(25.5);
      }
    }
  });

  it("returns strictly ascending, de-duplicated whole percentages", () => {
    for (let pct = 10; pct <= 17; pct += 0.25) {
      const { total, included } = billWith(1000, pct);
      const pcts = tipTiersFor(total, included).tiers.map((t) => t.pct);
      expect(pcts).toEqual([...new Set(pcts)]);
      expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
      for (const p of pcts) expect(Number.isInteger(p)).toBe(true);
    }
  });
});

describe("tipTiersFor — reduced band (> 17% included)", () => {
  it("shows 3/5/7% just above the 17% boundary", () => {
    const { total, included } = billWith(1000, 17.5);
    const plan = tipTiersFor(total, included);
    expect(plan.band).toBe("reduced");
    expect(plan.tiers.map((t) => t.pct)).toEqual([3, 5, 7]);
    expect(plan.tiers.map((t) => t.amount)).toEqual([30, 50, 70]);
  });

  it("shows 3/5/7% for a generous 20% auto-gratuity", () => {
    const { total, included } = billWith(1000, 20);
    expect(tipTiersFor(total, included).tiers.map((t) => t.pct)).toEqual([
      3, 5, 7,
    ]);
  });

  it("handles an already-fully-tipped bill (gratuity only, no base)", () => {
    const plan = tipTiersFor(500, 500);
    expect(plan.band).toBe("reduced");
    expect(plan.includedPct).toBe(Number.POSITIVE_INFINITY);
    // No pre-gratuity base to charge against, so fall back to the bill total
    // rather than offering three 0-value tip buttons.
    expect(plan.base).toBe(500);
    expect(plan.tiers.map((t) => t.amount)).toEqual([15, 25, 35]);
  });
});

describe("tipTiersFor — degenerate input", () => {
  it("returns zero-value standard tiers for a zero bill", () => {
    const plan = tipTiersFor(0, 0);
    expect(plan.band).toBe("standard");
    expect(plan.tiers.map((t) => t.amount)).toEqual([0, 0, 0]);
  });

  it("clamps a negative bill and a negative gratuity", () => {
    const plan = tipTiersFor(-100, -20);
    expect(plan.base).toBe(0);
    expect(plan.includedAmount).toBe(0);
    expect(plan.tiers.map((t) => t.pct)).toEqual([20, 23, 25]);
  });

  it("never suggests a 0% or negative tip", () => {
    for (let pct = 0; pct <= 60; pct += 0.5) {
      const { total, included } = billWith(1000, pct);
      for (const tier of tipTiersFor(total, included).tiers) {
        expect(tier.pct).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("tipTierNotice", () => {
  it("is silent when nothing is included", () => {
    expect(tipTierNotice(tipTiersFor(1000, 0))).toBeNull();
  });

  it("explains the pro-rated band", () => {
    const { total, included } = billWith(1000, 12);
    expect(tipTierNotice(tipTiersFor(total, included))).toContain("12%");
  });

  it("explains the reduced band", () => {
    const { total, included } = billWith(1000, 20);
    expect(tipTierNotice(tipTiersFor(total, included))).toContain("lower");
  });
});
