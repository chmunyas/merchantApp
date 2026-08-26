import { describe, expect, it } from "vitest";

import {
  bucketFor,
  buildAgingReport,
  daysPastDue,
  type AgingInvoice,
} from "../../src/lib/ar-aging";

const AS_OF = "2026-08-25T12:00:00Z";

const inv = (over: Partial<AgingInvoice> = {}): AgingInvoice => ({
  number: "INV-1",
  customerName: "Achieng Traders",
  phone: "254712345678",
  balanceMinor: 100_000,
  dueDate: "2026-08-01",
  issuedAt: "2026-07-01T00:00:00Z",
  ...over,
});

describe("ageing runs from the due date, not the issue date", () => {
  it("treats an invoice inside its terms as current", () => {
    // Issued 55 days ago, but on 60-day terms — nothing is owed late yet.
    const days = daysPastDue(
      { dueDate: "2026-08-30", issuedAt: "2026-07-01T00:00:00Z" },
      AS_OF,
    );
    expect(days).toBe(0);
    expect(bucketFor(days)).toBe("current");
  });

  it("counts days past the due date only", () => {
    expect(daysPastDue({ dueDate: "2026-08-01", issuedAt: "2026-01-01" }, AS_OF)).toBe(24);
  });

  it("treats a missing due date as due on receipt", () => {
    expect(daysPastDue({ dueDate: null, issuedAt: "2026-08-15T00:00:00Z" }, AS_OF)).toBe(10);
  });

  it("never reports negative age for a future-dated invoice", () => {
    expect(daysPastDue({ dueDate: "2026-12-01", issuedAt: "2026-08-01" }, AS_OF)).toBe(0);
  });
});

describe("bucket boundaries match the standard report", () => {
  it("places each day in the conventional bucket", () => {
    expect(bucketFor(0)).toBe("current");
    expect(bucketFor(1)).toBe("d1_30");
    expect(bucketFor(30)).toBe("d1_30");
    expect(bucketFor(31)).toBe("d31_60");
    expect(bucketFor(60)).toBe("d31_60");
    expect(bucketFor(61)).toBe("d61_90");
    expect(bucketFor(90)).toBe("d61_90");
    expect(bucketFor(91)).toBe("d90_plus");
  });
});

describe("aging report", () => {
  it("totals every bucket and reconciles to the grand total", () => {
    const report = buildAgingReport(
      [
        inv({ number: "A", dueDate: "2026-09-30", balanceMinor: 10_000 }),
        inv({ number: "B", dueDate: "2026-08-10", balanceMinor: 20_000 }),
        inv({ number: "C", dueDate: "2026-07-10", balanceMinor: 30_000 }),
        inv({ number: "D", dueDate: "2026-06-10", balanceMinor: 40_000 }),
        inv({ number: "E", dueDate: "2026-01-10", balanceMinor: 50_000 }),
      ],
      AS_OF,
    );
    expect(report.buckets.current).toBe(10_000);
    expect(report.buckets.d1_30).toBe(20_000);
    expect(report.buckets.d31_60).toBe(30_000);
    expect(report.buckets.d61_90).toBe(40_000);
    expect(report.buckets.d90_plus).toBe(50_000);

    const summed = Object.values(report.buckets).reduce((a, b) => a + b, 0);
    expect(summed).toBe(report.totalMinor);
    expect(report.totalMinor).toBe(150_000);
  });

  it("separates overdue from current — the number a controller chases", () => {
    const report = buildAgingReport(
      [
        inv({ number: "A", dueDate: "2026-09-30", balanceMinor: 10_000 }),
        inv({ number: "B", dueDate: "2026-08-10", balanceMinor: 20_000 }),
      ],
      AS_OF,
    );
    expect(report.overdueMinor).toBe(20_000);
  });

  it("rolls up by customer so a merchant sees who owes what", () => {
    const report = buildAgingReport(
      [
        inv({ number: "A", phone: "254700000001", customerName: "Achieng", balanceMinor: 10_000, dueDate: "2026-08-20" }),
        inv({ number: "B", phone: "254700000001", customerName: "Achieng", balanceMinor: 15_000, dueDate: "2026-05-01" }),
        inv({ number: "C", phone: "254700000002", customerName: "Otieno", balanceMinor: 5_000, dueDate: "2026-08-24" }),
      ],
      AS_OF,
    );
    expect(report.customers).toHaveLength(2);
    const achieng = report.customers.find((c) => c.phone === "254700000001")!;
    expect(achieng.totalMinor).toBe(25_000);
    expect(achieng.invoiceCount).toBe(2);
    expect(achieng.oldestDaysPastDue).toBeGreaterThan(100);
  });

  it("identifies one payer by phone even when the name is typed differently", () => {
    const report = buildAgingReport(
      [
        inv({ number: "A", phone: "254700000001", customerName: "Achieng Traders" }),
        inv({ number: "B", phone: "254700000001", customerName: "achieng traders ltd" }),
      ],
      AS_OF,
    );
    expect(report.customers).toHaveLength(1);
  });

  it("puts the worst debt first", () => {
    const report = buildAgingReport(
      [
        inv({ number: "A", phone: "1", dueDate: "2026-08-24", balanceMinor: 90_000 }),
        inv({ number: "B", phone: "2", dueDate: "2026-01-01", balanceMinor: 10_000 }),
      ],
      AS_OF,
    );
    expect(report.customers[0].phone).toBe("2");
    expect(report.invoices[0].number).toBe("B");
  });

  it("ignores settled or credit-balance invoices", () => {
    const report = buildAgingReport(
      [inv({ balanceMinor: 0 }), inv({ number: "X", balanceMinor: -500 })],
      AS_OF,
    );
    expect(report.openCount).toBe(0);
    expect(report.totalMinor).toBe(0);
  });

  it("returns an empty report rather than failing on no receivables", () => {
    const report = buildAgingReport([], AS_OF);
    expect(report.totalMinor).toBe(0);
    expect(report.customers).toEqual([]);
    expect(report.buckets.d90_plus).toBe(0);
  });
});
