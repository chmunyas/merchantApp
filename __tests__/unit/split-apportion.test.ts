import { describe, expect, it } from "vitest";

import {
  apportion,
  apportionBill,
  lineSubtotal,
  shareForItems,
  type BillLine,
} from "../../src/lib/split-apportion";

// A2.2 — the apportionment is the money. If it is wrong the venue is short, or
// the guest is overcharged, and neither shows up until reconciliation. So the
// invariant under test everywhere below is the same one: the per-line amounts
// sum to the bill total EXACTLY. No cent created, no cent lost.

describe("apportion — exactness", () => {
  it("sums to the total for an even division", () => {
    expect(apportion([100, 100, 100], 300)).toEqual([100, 100, 100]);
  });

  it("hands out remainder cents by largest fractional part, not by rounding", () => {
    // 100 across three equal lines: 33.33 each, 1 cent left over.
    const result = apportion([1, 1, 1], 100);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
    expect(result).toEqual([34, 33, 33]);
  });

  it("never rounds each line independently (which would lose a cent)", () => {
    const weights = [333, 333, 334];
    const total = 1000;
    const naive = weights.map((w) => Math.round((total * w) / 1000));
    const exact = apportion(weights, total);
    expect(exact.reduce((a, b) => a + b, 0)).toBe(total);
    // The naive path is allowed to be right here; the point is that ours is
    // right BY CONSTRUCTION, not by luck.
    expect(exact.reduce((a, b) => a + b, 0)).toBe(
      naive.reduce((a, b) => a + b, 0),
    );
  });

  it("is exact for a pathological remainder (7 lines, prime total)", () => {
    const result = apportion([1, 1, 1, 1, 1, 1, 1], 1009);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1009);
    // 1009 = 7 x 144 + 1, so exactly one line carries the leftover cent.
    expect(result.filter((n) => n === 145)).toHaveLength(1);
    expect(result.filter((n) => n === 144)).toHaveLength(6);
  });

  it("is deterministic across calls — ties break by line order", () => {
    const a = apportion([1, 1, 1, 1], 10);
    const b = apportion([1, 1, 1, 1], 10);
    expect(a).toEqual(b);
    expect(a).toEqual([3, 3, 2, 2]);
  });

  it("shares equally when every weight is zero (a freebie bill with a service charge)", () => {
    const result = apportion([0, 0, 0], 100);
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
    expect(result).toEqual([34, 33, 33]);
  });

  it("handles no lines, a zero total and negative inputs without inventing money", () => {
    expect(apportion([], 500)).toEqual([]);
    expect(apportion([10, 20], 0)).toEqual([0, 0]);
    expect(apportion([10, 20], -500)).toEqual([0, 0]);
    expect(apportion([-10, 20], 300)).toEqual([0, 300]);
  });

  it("stays exact over a large randomised sweep", () => {
    let seed = 987654321;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let trial = 0; trial < 500; trial += 1) {
      const lines = 1 + rand(9);
      const weights = Array.from({ length: lines }, () => rand(9999));
      const total = rand(2_000_000);
      const result = apportion(weights, total);
      expect(result.reduce((a, b) => a + b, 0)).toBe(total);
      expect(result.every((n) => n >= 0)).toBe(true);
    }
  });
});

describe("apportionBill — tax, service charge and discount ride along", () => {
  const lines: BillLine[] = [
    { id: "a", qty: 1, price: 85000 }, // 850.00
    { id: "b", qty: 2, price: 35000 }, // 700.00
    { id: "c", qty: 1, price: 28000 }, // 280.00
  ];
  // Item subtotal = 183000. The POS bill carries a service charge, so the
  // authoritative total is HIGHER than the sum of the dishes.
  const totalWithService = 201300; // 183000 + 10% service

  it("charges a guest their dishes PLUS their slice of the service charge", () => {
    const byId = apportionBill(lines, totalWithService);
    // Line a is 850/1830 of the bill, so it carries 850/1830 of the service too.
    expect(byId.get("a")).toBe(93500);
    expect(byId.get("b")).toBe(77000);
    expect(byId.get("c")).toBe(30800);
    expect(
      [...byId.values()].reduce((a, b) => a + b, 0),
    ).toBe(totalWithService);
  });

  it("charges a guest their dishes MINUS their slice of a discount", () => {
    const discounted = 164700; // 183000 less a 10% promo
    const byId = apportionBill(lines, discounted);
    expect([...byId.values()].reduce((a, b) => a + b, 0)).toBe(discounted);
    expect(byId.get("a")).toBeLessThan(lineSubtotal(lines[0]));
  });

  it("splits the WHOLE bill when every guest between them takes every line", () => {
    const byId = apportionBill(lines, totalWithService);
    const guestOne = shareForItems(lines, totalWithService, ["a"]);
    const guestTwo = shareForItems(lines, totalWithService, ["b", "c"]);
    expect(guestOne + guestTwo).toBe(totalWithService);
    expect(guestOne).toBe(byId.get("a"));
  });

  it("never lets a partition of the lines over- or under-pay the check", () => {
    const odd: BillLine[] = [
      { id: "x", qty: 3, price: 333 },
      { id: "y", qty: 1, price: 1 },
      { id: "z", qty: 7, price: 143 },
    ];
    const total = 4321;
    const all = ["x", "y", "z"];
    for (const first of all) {
      const rest = all.filter((id) => id !== first);
      expect(
        shareForItems(odd, total, [first]) + shareForItems(odd, total, rest),
      ).toBe(total);
    }
  });

  it("selecting nothing owes nothing; selecting an unknown line adds nothing", () => {
    expect(shareForItems(lines, totalWithService, [])).toBe(0);
    expect(shareForItems(lines, totalWithService, ["nope"])).toBe(0);
  });
});
