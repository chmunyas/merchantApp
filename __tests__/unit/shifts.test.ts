import { describe, it, expect } from "vitest";

import { zReport } from "../../src/lib/shifts";

describe("zReport", () => {
  const payments = [
    { amount: 200000, tip_amount: 15000, staff_id: "s1", status: "succeeded" },
    { amount: 50000, tip_amount: 0, staff_id: "s2", status: "paid" },
    { amount: 99999, tip_amount: 0, staff_id: "s1", status: "pending" }, // ignored
  ];

  it("totals digital sales + tips + count, ignoring non-succeeded, and reconciles cash", () => {
    const r = zReport({
      payments,
      openingFloat: 100000,
      cashSales: 30000,
      cashCounted: 125000,
    });
    expect(r.digitalTotal).toBe(250000);
    expect(r.tips).toBe(15000);
    expect(r.txCount).toBe(2);
    expect(r.expectedCash).toBe(130000); // float 100000 + cash sales 30000
    expect(r.variance).toBe(-5000); // counted 125000 - expected 130000 (short)
    expect(r.grossTotal).toBe(280000); // digital 250000 + cash sales 30000
    expect(r.byStaff[0].staffId).toBe("s1"); // 200000 > 50000
    expect(r.byStaff[0].total).toBe(200000);
  });

  it("leaves variance null when cash is not counted", () => {
    const r = zReport({ payments: [], openingFloat: 0 });
    expect(r.cashCounted).toBeNull();
    expect(r.variance).toBeNull();
    expect(r.digitalTotal).toBe(0);
    expect(r.txCount).toBe(0);
  });
});
