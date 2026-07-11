import { describe, it, expect, vi } from "vitest";

// A capturing stub Postgres client that returns invoice rows for the settlement
// lookups, so we can assert that a pay-link payment carrying an invoice_number
// (a) marks the invoice paid and (b) stores the M-Pesa receipt
// (connector_transaction_id) on the invoice as paid_ref — the same reference the
// customer and the merchant/staff both see.
const h = vi.hoisted(() => {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    // firstSuccess gate: SELECT status FROM payments WHERE id -> a new payment.
    if (/SELECT status FROM payments WHERE id/i.test(text)) {
      return Promise.resolve([] as unknown[]);
    }
    // settlement lookup: resolve the invoice id for (venue, number).
    if (/SELECT id FROM invoices\s+WHERE venue_id/i.test(text)) {
      return Promise.resolve([{ id: "inv-uuid-1" }] as unknown[]);
    }
    // recordPayment's invoice fetch (amount + running total).
    if (/SELECT amount, amount_paid, currency, number FROM invoices/i.test(text)) {
      return Promise.resolve([
        { amount: 100, amount_paid: 0, currency: "KES", number: "INV-1" },
      ] as unknown[]);
    }
    return Promise.resolve([] as unknown[]);
  }) as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
    json: (v: unknown) => unknown;
  };
  sql.json = (v: unknown) => v;
  return { calls, sql };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

import { handlePaymentRoute } from "../../src/api/payments";

const SECRET = "whsec_test_0123456789abcdef0123456789abcdef";

async function hmacHex(
  payload: string,
  secret: string,
  hash: "SHA-256" | "SHA-512",
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function webhookReq(body: string, headers: Record<string, string>): Request {
  return new Request("https://app.example.com/api/webhooks/pesaswap", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("invoice settlement — a pay-link payment ties to the invoice + carries the REF", () => {
  it("marks the invoice paid and stores connector_transaction_id as paid_ref", async () => {
    h.calls.length = 0;
    const body = JSON.stringify({
      event_id: "evt_inv_succ_1",
      event_type: "payment_succeeded",
      content: {
        object: {
          payment_id: "pay_inv_succ_abcdefghij1234567890",
          status: "succeeded",
          amount: 10000, // minor units -> KES 100
          currency: "KES",
          connector_transaction_id: "UGB5TBBAPB", // the M-Pesa receipt (REF)
          metadata: {
            venue: "v_test",
            merchant_id: "v_test",
            flow_type: "invoice",
            invoice_number: "INV-1",
            customer_phone: "+254719797394",
          },
        },
      },
    });
    const sig = await hmacHex(body, SECRET, "SHA-512");
    const res = await handlePaymentRoute(
      webhookReq(body, { "x-webhook-signature-512": sig }),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res!.status).toBe(200);

    // The receivable is settled: the invoice is marked paid...
    const paidUpdate = h.calls.find(
      (c) =>
        /UPDATE invoices SET amount_paid/i.test(c.text) &&
        /status = 'paid'/i.test(c.text),
    );
    expect(paidUpdate).toBeTruthy();
    // ...and the M-Pesa receipt is persisted on the invoice as paid_ref, tying the
    // payment, the invoice and the reference together for customer AND merchant.
    expect(paidUpdate!.values).toContain("UGB5TBBAPB");
  });
});
