import { describe, it, expect } from "vitest";

import { settledAmount } from "../../src/api/payments";

// M-Pesa/Daraja only moves whole shillings, so a decimal request settles rounded.
// The ledger must capture what ACTUALLY settled (amount_received), not the request.
describe("settledAmount", () => {
  it("captures amount_received (settled) for a succeeded payment", () => {
    // KES 1.01 requested (101 minor) but M-Pesa settles KES 1.00 (100 minor)
    expect(settledAmount({ amount: 101, amount_received: 100 }, "succeeded")).toBe(
      100,
    );
  });

  it("uses amount when received equals request (no rounding)", () => {
    expect(
      settledAmount({ amount: 5000, amount_received: 5000 }, "succeeded"),
    ).toBe(5000);
  });

  it("falls back to requested amount when amount_received is missing/zero", () => {
    expect(settledAmount({ amount: 250 }, "succeeded")).toBe(250);
    expect(
      settledAmount({ amount: 250, amount_received: 0 }, "succeeded"),
    ).toBe(250);
  });

  it("keeps the requested amount for a failed payment (nothing received)", () => {
    // A failed attempt has amount_received 0 — show what was attempted, not KES 0.
    expect(
      settledAmount({ amount: 700, amount_received: 0 }, "failed"),
    ).toBe(700);
  });

  it("keeps the requested amount for a processing payment", () => {
    expect(settledAmount({ amount: 300 }, "processing")).toBe(300);
  });
});
