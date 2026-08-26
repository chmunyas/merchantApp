import { describe, it, expect, vi } from "vitest";

// The isolate bug this file guards against:
//
// `payments.ts` used to keep a module-level `Map` of payments. On Workers that
// Map is PER-ISOLATE, so it only ever held payments the current isolate had
// created. A status poll or a provider webhook almost never lands on that same
// isolate, so at any real concurrency the Map missed — and the code treated a
// miss as "payment not found" (404) even though Postgres held the row.
//
// It passed every test and every low-traffic manual check, because a single warm
// isolate serves everything until it does not. These tests assert the durable
// read directly: the stub database returns a row and no cache is ever populated,
// so a passing result can only come from the ledger.

const h = vi.hoisted(() => {
  const calls: { text: string; values: unknown[] }[] = [];
  let paymentRow: Record<string, unknown> | null = null;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/SELECT id, amount, currency, status, metadata, created_at/i.test(text)) {
      return Promise.resolve(paymentRow ? [paymentRow] : []);
    }
    return Promise.resolve([] as unknown[]);
  }) as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
    json: (v: unknown) => unknown;
    begin: <T>(fn: (tx: typeof sql) => Promise<T>) => Promise<T>;
  };
  sql.json = (v: unknown) => v;
  sql.begin = async <T>(fn: (tx: typeof sql) => Promise<T>) => fn(sql);

  return {
    calls,
    sql,
    setPayment(row: Record<string, unknown> | null) {
      paymentRow = row;
    },
  };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

import { handlePaymentRoute } from "../../src/api/payments";

const ENV = { PAYMENTS_TEST_MODE: "1" };

function statusRequest(paymentId: string): Request {
  return new Request(
    `https://app.example.com/api/payments/${paymentId}/status`,
    { method: "GET" },
  );
}

describe("payment status reads come from the ledger, not an isolate cache", () => {
  it("returns a payment this isolate never created", async () => {
    h.calls.length = 0;
    h.setPayment({
      id: "pay_from_another_isolate",
      amount: 4284,
      currency: "KES",
      status: "succeeded",
      metadata: { venue: "v1" },
      created_at: "2026-08-24T10:00:00.000Z",
    });

    const response = await handlePaymentRoute(
      statusRequest("pay_from_another_isolate"),
      ENV,
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as Record<string, unknown>;
    expect(body.payment_id).toBe("pay_from_another_isolate");
    expect(body.status).toBe("succeeded");
    expect(body.amount).toBe(4284);
  });

  it("actually queries the database for it", async () => {
    h.calls.length = 0;
    h.setPayment({
      id: "pay_x",
      amount: 100,
      currency: "KES",
      status: "succeeded",
      metadata: {},
      created_at: "2026-08-24T10:00:00.000Z",
    });
    await handlePaymentRoute(statusRequest("pay_x"), ENV);
    const ledgerReads = h.calls.filter((c) =>
      /FROM payments WHERE id = \?/i.test(c.text),
    );
    expect(ledgerReads.length).toBeGreaterThan(0);
  });

  it("still 404s when the ledger genuinely has no such payment", async () => {
    h.calls.length = 0;
    h.setPayment(null);
    const response = await handlePaymentRoute(statusRequest("pay_missing"), ENV);
    expect(response!.status).toBe(404);
  });

  it("reports the ledger's amount rather than defaulting to zero", async () => {
    h.calls.length = 0;
    h.setPayment({
      id: "pay_amount",
      amount: 999,
      currency: "KES",
      status: "succeeded",
      metadata: {},
      created_at: "2026-08-24T10:00:00.000Z",
    });
    const response = await handlePaymentRoute(statusRequest("pay_amount"), ENV);
    const body = (await response!.json()) as Record<string, unknown>;
    expect(body.amount).toBe(999);
    expect(body.amount).not.toBe(0);
  });
});
