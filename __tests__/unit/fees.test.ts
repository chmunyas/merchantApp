import { describe, it, expect } from "vitest";

import {
  DEFAULT_FEE_SCHEDULE,
  INSTANT_PAYOUT_PERCENT,
  blendedRate,
  computeFee,
  feeTierFor,
  methodFromMetadata,
} from "../../src/lib/fees";

describe("fees — per-method engine", () => {
  it("applies the published percent per method (minor units)", () => {
    // KES 1000 = 100000 minor units.
    expect(computeFee(100000, "mpesa").fee).toBe(790); // 0.79%
    expect(computeFee(100000, "card").fee).toBe(1500); // 1.5%
    expect(computeFee(100000, "card_premium").fee).toBe(2900); // 2.9%
    expect(computeFee(100000, "pay_by_bank").fee).toBe(300); // 0.3%
    expect(computeFee(100000, "wallet").fee).toBe(1500); // 1.5%
  });

  it("computes net + effective rate", () => {
    const q = computeFee(100000, "mpesa");
    expect(q.net).toBe(100000 - 790);
    expect(q.rate).toBeCloseTo(0.79, 5);
    expect(q.method).toBe("mpesa");
  });

  it("adds the instant-payout surcharge on top of the method fee", () => {
    const base = computeFee(100000, "mpesa").fee; // 790
    const instant = computeFee(100000, "mpesa", { instantPayout: true }).fee;
    expect(instant).toBe(base + Math.round((100000 * INSTANT_PAYOUT_PERCENT) / 100));
    expect(instant).toBe(790 + 1000);
  });

  it("never charges more than the amount and handles zero", () => {
    expect(computeFee(0, "card").fee).toBe(0);
    expect(computeFee(0, "card").rate).toBe(0);
    // A pathological huge fixed fee would still be capped at the amount.
    const capped = computeFee(50, "mpesa", {
      schedule: [{ method: "mpesa", label: "M", percent: 0, fixed: 999999 }],
    });
    expect(capped.fee).toBe(50);
    expect(capped.net).toBe(0);
  });

  it("rounds to whole minor units", () => {
    // 12345 * 0.79% = 97.5255 -> rounds to 98.
    expect(computeFee(12345, "mpesa").fee).toBe(98);
  });

  it("has a tier for every method in the default schedule", () => {
    for (const t of DEFAULT_FEE_SCHEDULE) {
      expect(feeTierFor(t.method).method).toBe(t.method);
    }
  });
});

describe("fees — method resolution", () => {
  it("maps metadata to a billing method", () => {
    expect(methodFromMetadata({ method: "pay_by_bank" })).toBe("pay_by_bank");
    expect(methodFromMetadata({ payment_method: "bank_transfer" })).toBe("pay_by_bank");
    expect(methodFromMetadata({ method: "amex" })).toBe("card_premium");
    expect(methodFromMetadata({ method: "visa card" })).toBe("card");
    expect(methodFromMetadata({ method: "apple_pay" })).toBe("wallet");
    expect(methodFromMetadata({ flow_type: "tapgo" })).toBe("mpesa");
    expect(methodFromMetadata({ flow_type: "invoice" })).toBe("mpesa");
    expect(methodFromMetadata({})).toBe("mpesa"); // default rail
    expect(methodFromMetadata(null)).toBe("mpesa");
  });
});

describe("fees — blended effective rate", () => {
  it("aggregates gross, fees and rate across a method mix", () => {
    const rows = [
      { amount: 100000, fee: computeFee(100000, "mpesa").fee }, // 790
      { amount: 100000, fee: computeFee(100000, "card").fee }, // 1500
      { amount: 100000, fee: computeFee(100000, "pay_by_bank").fee }, // 300
    ];
    const b = blendedRate(rows);
    expect(b.gross).toBe(300000);
    expect(b.fees).toBe(2590);
    expect(b.net).toBe(297410);
    expect(b.count).toBe(3);
    // Blended rate sits between the cheapest and dearest method.
    expect(b.rate).toBeCloseTo((2590 / 300000) * 100, 5);
    expect(b.rate).toBeLessThan(1.5);
    expect(b.rate).toBeGreaterThan(0.3);
  });

  it("is zero for an empty ledger", () => {
    const b = blendedRate([]);
    expect(b.gross).toBe(0);
    expect(b.rate).toBe(0);
    expect(b.count).toBe(0);
  });
});
