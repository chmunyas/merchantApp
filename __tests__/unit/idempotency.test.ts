import { describe, it, expect, vi } from "vitest";

// A stateful stub Postgres that models the idempotency_keys reserve/store/recall
// so we can prove that a REPLAYED create (same Idempotency-Key) returns the same
// result and records the ledger only ONCE — the durable, cross-isolate guard.
const h = vi.hoisted(() => {
  const reserved = new Set<string>();
  const responses = new Map<string, unknown>();
  const ledger: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    // Atomic reserve: first writer gets the row, others get [].
    if (/INSERT INTO idempotency_keys \(key\) VALUES/i.test(text)) {
      const key = String(values[0]);
      if (reserved.has(key)) return Promise.resolve([] as unknown[]);
      reserved.add(key);
      return Promise.resolve([{ key }] as unknown[]);
    }
    // Store the completed response.
    if (/INSERT INTO idempotency_keys \(key, response\)/i.test(text)) {
      const key = String(values[0]);
      reserved.add(key);
      responses.set(key, values[1]);
      return Promise.resolve([] as unknown[]);
    }
    // Recall the response for a taken key.
    if (/SELECT response FROM idempotency_keys WHERE key/i.test(text)) {
      const key = String(values[0]);
      return Promise.resolve([{ response: responses.get(key) ?? null }] as unknown[]);
    }
    // recordLedger's first-success check → treat as a new payment.
    if (/SELECT status FROM payments WHERE id/i.test(text)) {
      return Promise.resolve([] as unknown[]);
    }
    // The ledger INSERT (unique column list from recordLedger).
    if (/INSERT INTO payments\s*\n?\s*\(id, venue_id/i.test(text)) {
      ledger.push({ text, values });
      return Promise.resolve([] as unknown[]);
    }
    return Promise.resolve([] as unknown[]);
  }) as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
    json: (v: unknown) => unknown;
  };
  sql.json = (v: unknown) => v;
  return { sql, ledger, reserved, responses };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

import { handlePaymentRoute } from "../../src/api/payments";

function createReq(key: string): Request {
  return new Request("https://app.example.com/api/payments/create", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      amount: 1000,
      currency: "KES",
      description: "idem",
      metadata: {
        venue: "v1",
        merchant_id: "v1",
        flow_type: "tapgo",
        merchant_name: "T",
        till_number: "0",
        customer_phone: "254700000000",
      },
    }),
  });
}

describe("payment idempotency (durable, cross-isolate)", () => {
  it("a replayed create with the same key returns the same payment + records once", async () => {
    h.ledger.length = 0;
    h.reserved.clear();
    h.responses.clear();
    const env = { PAYMENTS_TEST_MODE: "1" };
    const key = "idem-unit-1";

    const r1 = await handlePaymentRoute(createReq(key), env);
    const r2 = await handlePaymentRoute(createReq(key), env);
    const b1 = (await r1!.json()) as { payment_id?: string; status?: string };
    const b2 = (await r2!.json()) as { payment_id?: string };

    expect(b1.status).toBe("succeeded");
    expect(b1.payment_id).toBeTruthy();
    // The replay returns the SAME payment, not a fresh one.
    expect(b2.payment_id).toBe(b1.payment_id);
    // ...and the ledger was written exactly once (no double-record).
    expect(h.ledger.length).toBe(1);
  });

  it("distinct keys create distinct payments", async () => {
    h.ledger.length = 0;
    h.reserved.clear();
    h.responses.clear();
    const env = { PAYMENTS_TEST_MODE: "1" };

    const a = (await (await handlePaymentRoute(createReq("k-a"), env))!.json()) as {
      payment_id?: string;
    };
    const b = (await (await handlePaymentRoute(createReq("k-b"), env))!.json()) as {
      payment_id?: string;
    };
    expect(a.payment_id).not.toBe(b.payment_id);
    expect(h.ledger.length).toBe(2);
  });
});
