import { describe, it, expect } from "vitest";

import { loyaltyPointsFor, tierProgress } from "../../src/lib/loyalty";

describe("loyaltyPointsFor", () => {
  it("awards ~1 point per KES 10 (amount is minor units)", () => {
    expect(loyaltyPointsFor(100000)).toBe(100); // KES 1,000
    expect(loyaltyPointsFor(45000)).toBe(45); // KES 450
    expect(loyaltyPointsFor(999)).toBe(0); // under KES 10
  });

  it("never goes negative", () => {
    expect(loyaltyPointsFor(-500)).toBe(0);
    expect(loyaltyPointsFor(Number.NaN)).toBe(0);
  });

  it("lines up with the tier ladder", () => {
    // KES 5,000 spend → 500 points → Silver
    expect(tierProgress(loyaltyPointsFor(500000)).tier).toBe("Silver");
  });
});
