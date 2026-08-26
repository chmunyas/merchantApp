import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateInvoiceInput } from "../../src/lib/invoice-validation";
import {
  allocateFixedTips,
  allocateWeightedTips,
} from "../../src/lib/tip-allocation";

describe("invoice finance validation", () => {
  it("accepts positive KES lines and derives tax/total", () => {
    expect(validateInvoiceInput({
      currency: "kes",
      lineItems: [
        { description: "Lunch", qty: 2, price: 500 },
        { description: "Tea", qty: 1, price: 100 },
      ],
      taxRate: 10,
      expectedTotal: 1210,
    })).toMatchObject({
      subtotal: 1100,
      taxAmount: 110,
      amount: 1210,
      currency: "KES",
    });
  });

  it.each([
    { amount: Number.NaN },
    { amount: Number.POSITIVE_INFINITY },
    { amount: -1 },
    // USD/EUR/GBP/UGX/TZS are supported now; an unlisted currency still isn't.
    { amount: 100, currency: "ZAR" },
    { amount: 100, taxRate: -1 },
    { amount: 100, taxRate: 101 },
    { lineItems: [{ description: "", qty: 1, price: 10 }] },
    { lineItems: [{ description: "x", qty: 0, price: 10 }] },
    { lineItems: [{ description: "x", qty: 1, price: 0 }] },
  ])("rejects unsafe economics %#", (input) => {
    expect(validateInvoiceInput(input)).toHaveProperty("error");
  });

  it("rejects mismatched client totals and invalid calendar dates", () => {
    expect(validateInvoiceInput({
      lineItems: [{ description: "x", qty: 1, price: 100 }],
      expectedTotal: 99,
    })).toHaveProperty("error");
    expect(validateInvoiceInput({ amount: 100, dueDate: "2026-02-30" })).toHaveProperty("error");
  });
});

describe("tip allocation rules", () => {
  it("allocates equal tips with deterministic largest remainder", () => {
    expect(allocateWeightedTips(10, [
      { staffId: "b", weight: 1 },
      { staffId: "a", weight: 1 },
      { staffId: "c", weight: 1 },
    ])).toEqual([
      { staffId: "a", amount: 4 },
      { staffId: "b", amount: 3 },
      { staffId: "c", amount: 3 },
    ]);
  });

  it("allocates by-hours weights and preserves every minor unit", () => {
    const rows = allocateWeightedTips(101, [
      { staffId: "a", weight: 1 },
      { staffId: "b", weight: 3 },
    ]);
    expect(rows).toEqual([
      { staffId: "a", amount: 25 },
      { staffId: "b", amount: 76 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(101);
  });

  it("requires fixed allocations to sum exactly", () => {
    expect(allocateFixedTips(100, [
      { staffId: "a", amount: 40 },
      { staffId: "b", amount: 60 },
    ])).toHaveLength(2);
    expect(() => allocateFixedTips(100, [{ staffId: "a", amount: 99 }])).toThrow(/sum/);
  });
});

describe("Phase 5 migration controls", () => {
  it("contains invoice, tip, reconciliation, and audit controls", () => {
    const sql = readFileSync(resolve(process.cwd(), "db/64-finance-controls.sql"), "utf8");
    expect(sql).toMatch(/invoice_communication_outbox/i);
    expect(sql).toMatch(/invoice_payment_holds/i);
    expect(sql).toMatch(/tip_pools_no_overlap/i);
    expect(sql).toMatch(/tip_payout_evidence/i);
    expect(sql).toMatch(/provider_evidence_imports/i);
    expect(sql).toMatch(/reconciliation_matches/i);
    expect(sql).toMatch(/ledger_audit_checkpoints/i);
    expect(sql).toMatch(/provider_payouts_append_only/i);
    expect(sql).toMatch(/shifts_one_open_per_staff/i);
    expect(sql).toMatch(/invoices_public_number_key/i);
    const runner = readFileSync(resolve(process.cwd(), "scripts/migrate.mjs"), "utf8");
    expect(runner).toMatch(/sql\.begin/);
  });
});