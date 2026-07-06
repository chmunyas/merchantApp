import { describe, it, expect } from "vitest";

import {
  cogsLines,
  invoiceIssueLines,
  invoicePaymentLines,
  isBalanced,
  paymentLines,
  postEntry,
  refundLines,
  settlementLines,
  tipPayoutLines,
  type PostLine,
} from "../../src/lib/accounting";

type Sql = Parameters<typeof postEntry>[0];
// postEntry validates balance BEFORE touching the database, so an unbalanced
// entry never reaches this stub.
const sqlStub = null as unknown as Sql;

const debit = (lines: PostLine[], code: string) =>
  lines.find((l) => l.account === code)?.debit ?? 0;
const credit = (lines: PostLine[], code: string) =>
  lines.find((l) => l.account === code)?.credit ?? 0;
const sumDebit = (lines: PostLine[]) =>
  lines.reduce((s, l) => s + (l.debit ?? 0), 0);
const sumCredit = (lines: PostLine[]) =>
  lines.reduce((s, l) => s + (l.credit ?? 0), 0);

describe("paymentLines", () => {
  it("splits a tip out of revenue and keeps the entry balanced", () => {
    const lines = paymentLines(10000, 1500);
    expect(debit(lines, "1000")).toBe(10000); // cash received (gross)
    expect(credit(lines, "4000")).toBe(8500); // revenue net of tip
    expect(credit(lines, "2000")).toBe(1500); // tip owed to staff
    expect(isBalanced(lines)).toBe(true);
    expect(sumDebit(lines)).toBe(sumCredit(lines));
  });

  it("books the full amount as revenue when there is no tip", () => {
    const lines = paymentLines(10000, 0);
    expect(credit(lines, "4000")).toBe(10000);
    expect(lines.find((l) => l.account === "2000")).toBeUndefined();
    expect(isBalanced(lines)).toBe(true);
  });

  it("never lets a tip exceed the amount", () => {
    const lines = paymentLines(1000, 5000);
    expect(credit(lines, "2000")).toBe(1000);
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("refundLines", () => {
  it("reverses cash into returns and balances", () => {
    const lines = refundLines(2500);
    expect(debit(lines, "4900")).toBe(2500);
    expect(credit(lines, "1000")).toBe(2500);
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("settlementLines", () => {
  it("moves gross to bank net of fees and stays balanced", () => {
    const lines = settlementLines(100000, 1500);
    expect(debit(lines, "1010")).toBe(98500); // net to bank
    expect(debit(lines, "6000")).toBe(1500); // processing fees
    expect(credit(lines, "1000")).toBe(100000); // clearing settled
    expect(sumDebit(lines)).toBe(sumCredit(lines));
    expect(isBalanced(lines)).toBe(true);
  });

  it("derives net from gross - fees so it can never be unbalanced", () => {
    const lines = settlementLines(777, 13);
    expect(debit(lines, "1010") + debit(lines, "6000")).toBe(
      credit(lines, "1000"),
    );
  });
});

describe("tipPayoutLines", () => {
  it("clears the tips-payable liability against cash", () => {
    const lines = tipPayoutLines(3000);
    expect(debit(lines, "2000")).toBe(3000);
    expect(credit(lines, "1010")).toBe(3000);
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("invoiceIssueLines (accrual)", () => {
  it("books a receivable, revenue and tax and stays balanced", () => {
    const lines = invoiceIssueLines(1000, 160);
    expect(debit(lines, "1100")).toBe(1160); // A/R (total)
    expect(credit(lines, "4000")).toBe(1000); // revenue (subtotal)
    expect(credit(lines, "2100")).toBe(160); // tax payable
    expect(isBalanced(lines)).toBe(true);
  });

  it("omits the tax line when there is no tax", () => {
    const lines = invoiceIssueLines(1000, 0);
    expect(debit(lines, "1100")).toBe(1000);
    expect(credit(lines, "4000")).toBe(1000);
    expect(lines.find((l) => l.account === "2100")).toBeUndefined();
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("invoicePaymentLines (settlement)", () => {
  it("settles the receivable without re-recognising revenue", () => {
    const lines = invoicePaymentLines(1160);
    expect(debit(lines, "1000")).toBe(1160); // cash in
    expect(credit(lines, "1100")).toBe(1160); // A/R down
    expect(lines.find((l) => l.account === "4000")).toBeUndefined();
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("cogsLines", () => {
  it("expenses inventory cost and balances", () => {
    const lines = cogsLines(600);
    expect(debit(lines, "5000")).toBe(600);
    expect(credit(lines, "1200")).toBe(600);
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("accrual round-trip (issue then pay)", () => {
  it("recognises revenue once and leaves A/R at zero", () => {
    const issue = invoiceIssueLines(1000, 160);
    const pay = invoicePaymentLines(1160);
    const arNet =
      debit(issue, "1100") +
      debit(pay, "1100") -
      credit(issue, "1100") -
      credit(pay, "1100");
    const revenue = credit(issue, "4000") + credit(pay, "4000");
    expect(arNet).toBe(0); // receivable fully settled
    expect(revenue).toBe(1000); // revenue recognised exactly once
  });
});

describe("postEntry", () => {
  it("rejects an unbalanced entry (audit integrity)", async () => {
    await expect(
      postEntry(sqlStub, {
        venue: "main",
        sourceType: "manual",
        sourceId: "x",
        lines: [
          { account: "1000", debit: 100 },
          { account: "4000", credit: 50 },
        ],
      }),
    ).rejects.toThrow(/unbalanced/);
  });

  it("no-ops (returns null) when there is nothing to post", async () => {
    const result = await postEntry(sqlStub, {
      venue: "main",
      sourceType: "manual",
      sourceId: "empty",
      lines: [{ account: "1000", debit: 0, credit: 0 }],
    });
    expect(result).toBeNull();
  });
});
