import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { settleInvoicePayment } from "../../src/lib/invoicing";

// An invoice may only be settled through the ledger. If posting to the general
// ledger fails, the settlement must fail with it — a "paid" invoice sitting
// against an A/R balance that never cleared is a discrepancy an auditor finds
// months later, with no record of what went wrong.

type StubSql = ((s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>) & {
  json: (v: unknown) => unknown;
  begin: <T>(fn: (tx: StubSql) => Promise<T>) => Promise<T>;
};

function stubSql(opts: { failLedger?: boolean } = {}) {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (/FROM invoices/i.test(text)) {
      return Promise.resolve([
        { id: "inv-1", amount: 100, currency: "KES", status: "open" },
      ]);
    }
    if (/INSERT INTO journal_entries|INSERT INTO journal_lines/i.test(text)) {
      if (opts.failLedger) return Promise.reject(new Error("ledger unavailable"));
      return Promise.resolve([{ id: "je-1" }]);
    }
    if (/SELECT COALESCE\(sum\(amount\), 0\)/i.test(text)) {
      return Promise.resolve([{ applied: 0 }]);
    }
    return Promise.resolve([]);
  }) as StubSql;
  sql.json = (v: unknown) => v;
  sql.begin = async <T,>(fn: (tx: StubSql) => Promise<T>) => fn(sql);
  return { sql, calls };
}

const source = readFileSync("src/lib/invoicing.ts", "utf8");

describe("ledger failures are not swallowed", () => {
  it("posts to the ledger on a healthy settlement", async () => {
    // Positive control: proves the failure test below is actually intercepting
    // the ledger write rather than throwing somewhere earlier.
    const { sql, calls } = stubSql();
    await settleInvoicePayment(sql, {
      venue: "v_test",
      invoiceNumber: "INV-1",
      paymentId: "pay_1",
      amountMinor: 10000,
    });
    expect(calls.some((c) => /INSERT INTO journal_entries/i.test(c))).toBe(true);
  });

  it("fails the settlement when the ledger post throws", async () => {
    const { sql } = stubSql({ failLedger: true });
    await expect(
      settleInvoicePayment(sql, {
        venue: "v_test",
        invoiceNumber: "INV-1",
        paymentId: "pay_1",
        amountMinor: 10000,
      }),
    ).rejects.toThrow(/ledger unavailable/);
  });

  it("posts the A/R settlement inside the settling transaction", () => {
    // postEntryInTransaction, not a fire-and-forget post afterwards: a rollback
    // has to take the journal entry with it.
    expect(source).toMatch(/postEntryInTransaction\(tx, \{/);
  });

  it("keeps no best-effort accounting swallow anywhere in the module", () => {
    expect(source).not.toMatch(/best-effort accounting/);
    expect(source).not.toMatch(/catch \{\s*\/\* best-effort/);
  });

  it("refuses to settle a void invoice", async () => {
    const sql = ((strings: TemplateStringsArray) => {
      if (/FROM invoices/i.test(strings.join("?"))) {
        return Promise.resolve([
          { id: "inv-1", amount: 100, currency: "KES", status: "void" },
        ]);
      }
      return Promise.resolve([]);
    }) as StubSql;
    sql.json = (v: unknown) => v;
    sql.begin = async <T,>(fn: (tx: StubSql) => Promise<T>) => fn(sql);
    await expect(
      settleInvoicePayment(sql, {
        venue: "v_test",
        invoiceNumber: "INV-1",
        paymentId: "pay_1",
        amountMinor: 10000,
      }),
    ).rejects.toThrow(/void invoice/);
  });
});

describe("there is no second way to mark an invoice paid", () => {
  it("exposes no direct recordPayment writer", async () => {
    const mod = await import("../../src/lib/invoicing");
    expect(mod).not.toHaveProperty("recordPayment");
  });

  it("never writes amount_paid outside the reconciliation routine", () => {
    // Two writers to amount_paid means two chances to disagree with the ledger.
    const writers = source.match(/UPDATE invoices SET[\s\S]{0,80}amount_paid/g) ?? [];
    expect(writers).toHaveLength(0);
  });
});
