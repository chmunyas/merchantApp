import { describe, it, expect } from "vitest";

import { clampTip, tipSuggestions } from "../../src/lib/tip";

describe("tipSuggestions", () => {
  it("returns default 5/10/15% amounts of the base", () => {
    expect(tipSuggestions(1000)).toEqual([
      { pct: 5, amount: 50 },
      { pct: 10, amount: 100 },
      { pct: 15, amount: 150 },
    ]);
  });

  it("rounds and honours custom percentages", () => {
    expect(tipSuggestions(333, [10])).toEqual([{ pct: 10, amount: 33 }]);
  });

  it("handles a zero base", () => {
    expect(tipSuggestions(0).every((s) => s.amount === 0)).toBe(true);
  });
});

describe("clampTip", () => {
  it("floors at zero and rounds", () => {
    expect(clampTip(-5)).toBe(0);
    expect(clampTip(49.6)).toBe(50);
  });

  it("caps at max when given", () => {
    expect(clampTip(500, 100)).toBe(100);
    expect(clampTip(80, 100)).toBe(80);
  });
});
