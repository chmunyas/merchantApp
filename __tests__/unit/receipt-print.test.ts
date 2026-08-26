import { describe, expect, it } from "vitest";

import { buildPrintableReceipt } from "../../src/lib/receipt-print";

// A1.4 — a printed receipt is a document a guest may keep, dispute or expense.
// The numbers on it must be the numbers that were charged, and each one must be
// walkable back to a payment id.

const base = {
  venueName: "Kilimani Kitchen",
  orderId: "order-9",
  currency: "KES",
  issuedAt: "2026-08-24T10:00:00.000Z",
};

describe("buildPrintableReceipt", () => {
  it("prices lines by quantity and sums the subtotal", () => {
    const receipt = buildPrintableReceipt({
      ...base,
      totalMinor: 4_600,
      items: [
        { name: "Flat white", qty: 2, price: 450 },
        { name: "Chicken wrap", qty: 1, price: 1_200 },
      ],
      payments: [],
    });

    expect(receipt.lines[0].totalMinor).toBe(900);
    expect(receipt.subtotalMinor).toBe(2_100);
    expect(receipt.totalMinor).toBe(4_600);
  });

  it("excludes the tip from what counts as paid against the bill", () => {
    const receipt = buildPrintableReceipt({
      ...base,
      totalMinor: 4_600,
      items: [],
      payments: [
        { id: "pay_1", amount: 5_100, tip_amount: 500, provider: "mpesa" },
      ],
    });

    expect(receipt.tipMinor).toBe(500);
    expect(receipt.paidMinor).toBe(4_600);
    expect(receipt.remainingMinor).toBe(0);
    expect(receipt.settled).toBe(true);
  });

  it("shows an outstanding balance when the bill is only part-paid", () => {
    const receipt = buildPrintableReceipt({
      ...base,
      totalMinor: 4_600,
      items: [],
      payments: [{ id: "pay_1", amount: 2_000, tip_amount: 0 }],
    });

    expect(receipt.paidMinor).toBe(2_000);
    expect(receipt.remainingMinor).toBe(2_600);
    expect(receipt.settled).toBe(false);
  });

  it("names every payment behind the total", () => {
    const receipt = buildPrintableReceipt({
      ...base,
      totalMinor: 4_600,
      items: [],
      payments: [
        { id: "pay_1", amount: 2_300, tip_amount: 0, reference: "REF1" },
        { id: "pay_2", amount: 2_300, tip_amount: 0, reference: "REF2" },
      ],
    });

    expect(receipt.payments.map((p) => p.id)).toEqual(["pay_1", "pay_2"]);
    expect(receipt.payments[1].reference).toBe("REF2");
  });

  it("never reports a negative outstanding balance on an overpaid bill", () => {
    const receipt = buildPrintableReceipt({
      ...base,
      totalMinor: 1_000,
      items: [],
      payments: [{ id: "pay_1", amount: 1_500, tip_amount: 0 }],
    });

    expect(receipt.remainingMinor).toBe(0);
    expect(receipt.settled).toBe(true);
  });

  it("carries the discount and service charge through untouched", () => {
    const receipt = buildPrintableReceipt({
      ...base,
      totalMinor: 4_600,
      discountMinor: 500,
      serviceChargeMinor: 460,
      items: [],
      payments: [],
    });

    expect(receipt.discountMinor).toBe(500);
    expect(receipt.serviceChargeMinor).toBe(460);
  });
});
