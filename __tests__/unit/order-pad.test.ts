import { describe, it, expect } from "vitest";

import { toOrderItems, orderPadTotal } from "../../src/lib/order-pad";

describe("order pad conversion", () => {
  it("converts whole KES menu prices to minor units for the order API", () => {
    const items = toOrderItems([
      { name: "Nyama Choma Platter", price: 1450, qty: 2, notes: "" },
      { name: "Chapati", price: 220, qty: 1, notes: "  well done  " },
    ]);
    expect(items).toEqual([
      { name: "Nyama Choma Platter", qty: 2, price: 145000, notes: undefined },
      { name: "Chapati", qty: 1, price: 22000, notes: "well done" },
    ]);
  });

  it("drops empty lines (qty 0 or blank name)", () => {
    const items = toOrderItems([
      { name: "Tea", price: 100, qty: 0, notes: "" },
      { name: "   ", price: 500, qty: 3, notes: "" },
      { name: "Soda", price: 150, qty: 1, notes: "" },
    ]);
    expect(items).toEqual([
      { name: "Soda", qty: 1, price: 15000, notes: undefined },
    ]);
  });

  it("totals in whole KES to match the menu", () => {
    expect(
      orderPadTotal([
        { name: "A", price: 1450, qty: 2, notes: "" },
        { name: "B", price: 220, qty: 1, notes: "" },
      ]),
    ).toBe(3120);
  });
});
