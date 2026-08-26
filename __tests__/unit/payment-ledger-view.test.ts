import { describe, expect, it } from "vitest";

import {
  isSettledPayment,
  netSettledAmount,
  paymentFlowLabel,
  paymentMatchesFilter,
  paymentStatusLabel,
  type PaymentLedgerRow,
} from "../../src/lib/payment-ledger";

function payment(overrides: Partial<PaymentLedgerRow> = {}): PaymentLedgerRow {
  return {
    id: "pay_1",
    amount: 12_000,
    currency: "KES",
    status: "succeeded",
    kind: "payment",
    reference: "TG-123",
    providerRef: "MPESA123",
    tipAmount: 2_000,
    initiator: "human",
    customerPhone: "+254700000001",
    customerName: "Guest",
    flowType: "tapgo",
    sourceId: "TG-123",
    invoiceNumber: null,
    errorMessage: null,
    refundedAmount: 0,
    refundOf: null,
    refundReason: null,
    createdAt: "2026-08-25T09:00:00.000Z",
    ...overrides,
  };
}

describe("operator payment ledger presentation", () => {
  it("counts only settled payment rows and nets parent refunds once", () => {
    const rows = [
      payment({
        amount: 12_000,
        status: "partially_refunded",
        refundedAmount: 3_000,
      }),
      payment({ id: "pay_processing", amount: 8_000, status: "processing" }),
      payment({
        id: "refund_1",
        kind: "refund",
        status: "refunded",
        amount: 3_000,
        refundOf: "pay_1",
      }),
    ];

    expect(rows.filter(isSettledPayment).map((row) => row.id)).toEqual([
      "pay_1",
    ]);
    expect(netSettledAmount(rows)).toBe(9_000);
    expect(paymentMatchesFilter(rows[0], "settled")).toBe(false);
    expect(paymentMatchesFilter(rows[0], "refunded")).toBe(true);
  });

  it("keeps terminal failures, processing, and refund context distinct", () => {
    const failed = payment({ status: "failed", errorMessage: "Declined" });
    const processing = payment({ id: "pay_2", status: "processing" });
    const partiallyRefunded = payment({
      id: "pay_3",
      status: "partially_refunded",
      refundedAmount: 1_000,
    });

    expect(paymentMatchesFilter(failed, "failed")).toBe(true);
    expect(paymentMatchesFilter(failed, "settled")).toBe(false);
    expect(paymentMatchesFilter(processing, "processing")).toBe(true);
    expect(paymentMatchesFilter(partiallyRefunded, "refunded")).toBe(true);
    expect(paymentStatusLabel(processing.status)).toBe("Processing");
    expect(paymentStatusLabel(partiallyRefunded.status)).toBe(
      "Partially refunded",
    );
  });

  it("uses customer-readable flow labels without hiding invoice identity", () => {
    expect(paymentFlowLabel(payment())).toBe("Tap & Go");
    expect(
      paymentFlowLabel(
        payment({ flowType: "invoice", invoiceNumber: "INV-1042" }),
      ),
    ).toBe("Invoice INV-1042");
    expect(paymentFlowLabel(payment({ kind: "refund" }))).toBe("Refund");
  });
});
