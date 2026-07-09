import { describe, it, expect } from "vitest";

import { commissionAmount } from "../../src/lib/commission";

describe("commissionAmount (reseller revenue share)", () => {
  it("computes basis-point commission on minor-unit amounts", () => {
    // KES 20,000 = 2,000,000 minor at 3% (300 bps) => KES 600 = 60,000 minor.
    expect(commissionAmount(2_000_000, 300)).toBe(60_000);
    // 1% (100 bps) default.
    expect(commissionAmount(1_000_000, 100)).toBe(10_000);
    // 2.5% (250 bps) of 1,500,000 => 37,500.
    expect(commissionAmount(1_500_000, 250)).toBe(37_500);
  });

  it("rounds to the nearest minor unit", () => {
    expect(commissionAmount(333, 100)).toBe(3); // 3.33 -> 3
  });

  it("returns 0 for non-positive gross or bps", () => {
    expect(commissionAmount(0, 300)).toBe(0);
    expect(commissionAmount(1_000_000, 0)).toBe(0);
    expect(commissionAmount(-100, 300)).toBe(0);
  });
});
