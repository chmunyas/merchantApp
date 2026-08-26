import { describe, expect, it } from "vitest";

import { toCustomerPaymentView } from "../../src/lib/customer-payment-view";

describe("customer payment receipt projection", () => {
  it("returns bill, tip, receipt, source and refund context without raw metadata", () => {
    const view = toCustomerPaymentView({
      id: "pay_1",
      amount: "12500",
      currency: "KES",
      status: "partially_refunded",
      kind: "payment",
      reference: "TG-123",
      provider_ref: "MPESA-REF",
      tip_amount: "2500",
      refunded_amount: "3000",
      created_at: "2026-08-25T09:00:00.000Z",
      metadata: {
        flow_type: "tapgo",
        source_id: "TG-123",
        invoice_number: "INV-12",
        refund_reason: "Item unavailable",
        customer_phone: "+254700000001",
        device_fingerprint: "must-not-leak",
      },
    });

    expect(view).toMatchObject({
      amount: 12_500,
      principalAmount: 10_000,
      tipAmount: 2_500,
      providerRef: "MPESA-REF",
      flowType: "tapgo",
      sourceId: "TG-123",
      invoiceNumber: "INV-12",
      refundedAmount: 3_000,
      refundReason: "Item unavailable",
      canRequestRefund: true,
    });
    expect(view).not.toHaveProperty("metadata");
    expect(view).not.toHaveProperty("customer_phone");
    expect(view).not.toHaveProperty("device_fingerprint");
  });

  it("does not offer another refund request for refund rows or fully refunded payments", () => {
    const base = {
      id: "pay_1",
      amount: 10_000,
      currency: "KES",
      reference: null,
      provider_ref: null,
      tip_amount: 0,
      metadata: {},
      created_at: "2026-08-25T09:00:00.000Z",
    };

    expect(
      toCustomerPaymentView({
        ...base,
        status: "refunded",
        kind: "payment",
        refunded_amount: 10_000,
      }).canRequestRefund,
    ).toBe(false);
    expect(
      toCustomerPaymentView({
        ...base,
        id: "refund_1",
        status: "refunded",
        kind: "refund",
        refunded_amount: 0,
      }).canRequestRefund,
    ).toBe(false);
  });
});
