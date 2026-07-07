import { describe, it, expect } from "vitest";

import {
  byItemShare,
  clampShare,
  equalShares,
  remaining,
  validateCustom,
  type SplitLineItem,
} from "../../src/lib/split-bill";

describe("equalShares", () => {
  it("splits evenly when it divides", () => {
    expect(equalShares(900, 3)).toEqual([300, 300, 300]);
  });

  it("distributes the remainder cents to the first parties and sums exactly", () => {
    const shares = equalShares(1000, 3);
    expect(shares).toEqual([334, 333, 333]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(equalShares(1001, 2)).toEqual([501, 500]);
  });

  it("guards party count", () => {
    expect(equalShares(500, 0)).toEqual([500]);
  });
});

describe("byItemShare", () => {
  const items: SplitLineItem[] = [
    { name: "Steak", qty: 1, price: 145000 },
    { name: "Beer", qty: 3, price: 25000 },
    { name: "Cake", qty: 1, price: 42000 },
  ];

  it("sums the selected items (qty × price)", () => {
    expect(byItemShare(items, [0])).toBe(145000);
    expect(byItemShare(items, [1, 2])).toBe(3 * 25000 + 42000);
    expect(byItemShare(items, [])).toBe(0);
  });
});

describe("remaining + clampShare", () => {
  it("computes the outstanding balance", () => {
    expect(remaining(1000, 300)).toBe(700);
    expect(remaining(1000, 1000)).toBe(0);
    expect(remaining(1000, 1200)).toBe(0); // never negative
  });

  it("clamps a share to what is still owed", () => {
    expect(clampShare(800, 700)).toBe(700); // can't overpay
    expect(clampShare(500, 700)).toBe(500);
    expect(clampShare(-5, 700)).toBe(0);
  });
});

describe("validateCustom", () => {
  it("passes when amounts sum to the total", () => {
    expect(validateCustom(1000, [400, 600])).toEqual({
      valid: true,
      sum: 1000,
      diff: 0,
    });
  });

  it("reports the shortfall/overage", () => {
    expect(validateCustom(1000, [400, 500])).toEqual({
      valid: false,
      sum: 900,
      diff: 100,
    });
  });
});
