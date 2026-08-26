import { describe, expect, it } from "vitest";

import { scoreCustomerHealth } from "../../src/lib/customer-health";

const now = new Date("2026-08-26T12:00:00.000Z");

function invoice(
  status: "Paid" | "Pending" | "Overdue" | "Partial" | "Void" = "Paid",
  amount = 1000,
) {
  return {
    amount,
    status,
    timeline: [{ label: "Created", at: "2026-08-25T12:00:00.000Z" }],
    paidAt: status === "Paid" ? "2026-08-25T12:00:00.000Z" : undefined,
  } as const;
}

describe("scoreCustomerHealth", () => {
  it("returns a fully paid healthy score from invoice evidence", () => {
    const result = scoreCustomerHealth([invoice(), invoice()], now);

    expect(result.score).toBe(89);
    expect(result.band).toBe("Healthy");
    expect(result.paidInvoices).toBe(2);
    expect(result.totalInvoices).toBe(2);
    expect(result.outstanding).toBe(0);
    expect(result.paymentReliability).toBe(40);
    expect(result.recency).toBe(24);
    expect(result.engagement).toBe(10);
    expect(result.exposure).toBe(15);
  });

  it("reduces health when invoices remain overdue", () => {
    const result = scoreCustomerHealth(
      [invoice("Paid"), invoice("Overdue", 2000)],
      now,
    );

    expect(result.score).toBe(59);
    expect(result.band).toBe("Watch");
    expect(result.outstanding).toBe(2000);
    expect(result.paidInvoices).toBe(1);
  });

  it("ignores void invoices and handles an empty customer", () => {
    const result = scoreCustomerHealth(
      [invoice("Void"), invoice("Pending")],
      now,
    );

    expect(result.totalInvoices).toBe(1);
    expect(result.score).toBe(29);
    expect(result.band).toBe("At risk");
  });
});
