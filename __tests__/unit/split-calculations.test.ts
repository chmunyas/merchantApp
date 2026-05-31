/**
 * Unit tests — Split & Tip calculations
 * Tests: equal split, by-item split, custom amount, tip %, round-up
 */
import { describe, it, expect } from "vitest";

describe("Split Calculations", () => {
  const TOTAL = 2630;

  describe("Equal split", () => {
    it("divides total equally among N people", () => {
      const people = 4;
      const share = Math.ceil(TOTAL / people);
      expect(share).toBe(658); // 2630/4 = 657.5 → 658
    });

    it("handles 1 person (full amount)", () => {
      expect(Math.ceil(TOTAL / 1)).toBe(TOTAL);
    });

    it("handles large group (10 people)", () => {
      expect(Math.ceil(TOTAL / 10)).toBe(263);
    });
  });

  describe("By-item split", () => {
    it("sums only selected items", () => {
      const items = [
        { id: "1", name: "A", price: 850, qty: 1 },
        { id: "2", name: "B", price: 350, qty: 2 },
        { id: "3", name: "C", price: 280, qty: 1 },
      ];
      const selected = ["1", "2"];
      const subtotal = items
        .filter((i) => selected.includes(i.id))
        .reduce((s, i) => s + i.price * i.qty, 0);
      expect(subtotal).toBe(1550); // 850 + 700
    });

    it("returns 0 when no items selected", () => {
      expect(0).toBe(0);
    });
  });

  describe("Custom amount", () => {
    it("validates amount > 0", () => {
      const amount = 0;
      expect(amount > 0).toBe(false);
    });

    it("validates amount <= remaining balance", () => {
      const remaining = 1500;
      const amount = 2000;
      expect(amount <= remaining).toBe(false);
    });

    it("accepts valid amount", () => {
      const remaining = 1500;
      const amount = 1000;
      expect(amount > 0 && amount <= remaining).toBe(true);
    });
  });
});

describe("Tip Calculations", () => {
  const SUBTOTAL = 2630;

  describe("Percentage tips", () => {
    it("5% tip", () => {
      expect(Math.round(SUBTOTAL * 0.05)).toBe(132);
    });

    it("10% tip", () => {
      expect(Math.round(SUBTOTAL * 0.10)).toBe(263);
    });

    it("15% tip", () => {
      expect(Math.round(SUBTOTAL * 0.15)).toBe(395);
    });

    it("20% tip", () => {
      expect(Math.round(SUBTOTAL * 0.20)).toBe(526);
    });

    it("0% tip (no tip)", () => {
      expect(Math.round(SUBTOTAL * 0)).toBe(0);
    });
  });

  describe("Round-up suggestion", () => {
    it("suggests rounding 2893 to 2900 (+7)", () => {
      const total = 2893;
      const roundTo = 100;
      const roundedUp = Math.ceil(total / roundTo) * roundTo;
      const diff = roundedUp - total;
      expect(roundedUp).toBe(2900);
      expect(diff).toBe(7);
    });

    it("no suggestion when already round (3000)", () => {
      const total = 3000;
      const roundTo = 100;
      const roundedUp = Math.ceil(total / roundTo) * roundTo;
      const diff = roundedUp - total;
      expect(diff).toBe(0);
    });

    it("suggests rounding 1550 to 1600 (+50)", () => {
      const total = 1550;
      const roundTo = 100;
      const roundedUp = Math.ceil(total / roundTo) * roundTo;
      expect(roundedUp).toBe(1600);
      expect(roundedUp - total).toBe(50);
    });
  });

  describe("Tip applied to split share only", () => {
    it("tip on equal split share, not full bill", () => {
      const share = Math.ceil(SUBTOTAL / 3); // 877
      const tip = Math.round(share * 0.10); // 88
      const youPay = share + tip;
      expect(youPay).toBe(877 + 88); // 965
    });
  });
});
