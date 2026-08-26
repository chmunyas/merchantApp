import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Parent = {
    venue: string;
    amount: number;
    refunded: number;
    currency: string;
    metadata: Record<string, unknown>;
  };
  const parents = new Map<string, Parent>();
  const reservations = new Map<string, Record<string, unknown>>();
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const ledger: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push({ text, values });

    if (/FROM user_venues uv/i.test(text)) {
      const email = String(values[0] ?? "");
      const role = email.split("@")[0];
      return Promise.resolve([{ role, membership_version: 1 }]);
    }

    if (
      /SELECT p\.amount::bigint AS amount, p\.currency, p\.metadata/i.test(text)
    ) {
      const paymentId = String(values[0]);
      const venue = String(values[1]);
      const parent = parents.get(paymentId);
      return Promise.resolve(
        parent && parent.venue === venue
          ? [
              {
                amount: parent.amount,
                refunded: parent.refunded,
                currency: parent.currency,
                metadata: parent.metadata,
              },
            ]
          : [],
      );
    }
    if (/SELECT id, amount, status, request_hash, provider_key/i.test(text)) {
      const key = `${String(values[0])}:${String(values[1])}:${String(values[2])}`;
      const existing = reservations.get(key);
      return Promise.resolve(existing ? [existing] : []);
    }
    if (/AS settled[\s\S]*AS reserved/i.test(text)) {
      const parent = parents.get(String(values[0]));
      return Promise.resolve([{ settled: parent?.refunded ?? 0, reserved: 0 }]);
    }
    if (
      /SELECT id, venue_id, amount, currency, reference, metadata, tip_amount/i.test(
        text,
      )
    ) {
      const paymentId = String(values[0]);
      const venue = String(values[1]);
      const parent = parents.get(paymentId);
      return Promise.resolve(
        parent && parent.venue === venue
          ? [
              {
                id: paymentId,
                venue_id: parent.venue,
                amount: parent.amount,
                currency: parent.currency,
                reference: null,
                metadata: parent.metadata,
                tip_amount: 0,
                fee_amount: 0,
                settlement_id: null,
              },
            ]
          : [],
      );
    }
    if (/COALESCE\(sum\(amount\), 0\)::bigint AS refunded/i.test(text)) {
      const parent = parents.get(String(values[1] ?? values[0]));
      return Promise.resolve([{ refunded: parent?.refunded ?? 0 }]);
    }
    if (/SELECT id FROM payments WHERE id/i.test(text)) {
      return Promise.resolve([]);
    }
    if (/SELECT venue_id, reference, metadata FROM payments/i.test(text)) {
      const parent = parents.get(String(values[0]));
      return Promise.resolve(
        parent
          ? [
              {
                venue_id: parent.venue,
                reference: null,
                metadata: parent.metadata,
              },
            ]
          : [],
      );
    }
    if (/INSERT INTO payments\s*\n?\s*\(id, venue_id/i.test(text)) {
      ledger.push({ text, values });
      return Promise.resolve([]);
    }
    if (/INSERT INTO refund_reservations/i.test(text)) {
      const key = `${String(values[1])}:${String(values[2])}:${String(values[3])}`;
      reservations.set(key, {
        id: values[0],
        amount: values[4],
        status: "reserved",
        request_hash: values[5],
        provider_key: values[6],
        provider_refund_id: null,
        provider_status: null,
        provider_response: null,
      });
      return Promise.resolve([]);
    }
    if (/UPDATE refund_reservations/i.test(text)) {
      const reservation = [...reservations.values()].find(
        (row) => row.id === values.at(-1),
      );
      if (reservation) {
        if (text.includes("status = 'submitting'"))
          reservation.status = "submitting";
        else if (text.includes("status = 'unknown'"))
          reservation.status = "unknown";
        else if (values.includes("unknown")) reservation.status = "unknown";
        else if (values.includes("pending")) reservation.status = "pending";
        else if (text.includes("status = 'booked'"))
          reservation.status = "booked";
      }
      return Promise.resolve([]);
    }
    if (/SELECT p\.amount::bigint AS amount,/i.test(text)) {
      const parent = parents.get(String(values[0]));
      return Promise.resolve(
        parent ? [{ amount: parent.amount, refunded: parent.refunded }] : [],
      );
    }
    return Promise.resolve([]);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    json: (value: unknown) => unknown;
    begin: <T>(fn: (tx: typeof sql) => Promise<T>) => Promise<T>;
  };
  sql.json = (value) => value;
  sql.begin = async <T>(fn: (tx: typeof sql) => Promise<T>) => fn(sql);
  return { ledger, parents, queries, reservations, sql };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

import { handlePaymentRoute } from "../../src/api/payments";
import { signJwt } from "../../src/lib/jwt";

const JWT_SECRET = "refund-authorization-test-secret";
const env = {
  APP_ENV: "production",
  JWT_SECRET,
  PESASWAP_API_KEY: "test-api-key",
  PESASWAP_URL: "https://provider.example.com",
};

function refundRequest(
  token: string,
  body: Record<string, unknown> = {
    payment_id: "pay_owned",
    amount: 4_000,
    reason: "customer_request",
    metadata: { refunded_by: "forged-client", caller: "dashboard" },
  },
): Request {
  return new Request("https://merchant.example.com/api/refunds?venue=other", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "refund-owned-4000",
    },
    body: JSON.stringify(body),
  });
}

async function token(
  role: string,
  venue = "venue-a",
  extra: Record<string, unknown> = {},
): Promise<string> {
  return signJwt(
    {
      sub: `${role}@example.com`,
      role,
      venue,
      membership_version: 1,
      ...extra,
    },
    JWT_SECRET,
  );
}

describe("refund authorization and durable boundaries", () => {
  beforeEach(() => {
    h.parents.clear();
    h.reservations.clear();
    h.queries.length = 0;
    h.ledger.length = 0;
    h.parents.set("pay_owned", {
      venue: "venue-a",
      amount: 10_000,
      refunded: 2_000,
      currency: "KES",
      metadata: { merchant_id: "venue-a", customer_phone: "+254700000000" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            refund_id: "ref_settled_1",
            status: "succeeded",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an API token without payments:write", async () => {
    const scoped = await token("manager", "venue-a", {
      isApiToken: true,
      tokenId: "pat-1",
      scopes: ["payments:read"],
    });
    const response = await handlePaymentRoute(refundRequest(scoped), env);
    expect(response?.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not let the query string cross the principal's tenant", async () => {
    const manager = await token("manager", "venue-b");
    const response = await handlePaymentRoute(refundRequest(manager), env);
    expect(response?.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    const ownershipQuery = h.queries.find((q) =>
      /SELECT p\.amount::bigint AS amount, p\.currency/i.test(q.text),
    );
    expect(ownershipQuery?.values).toContain("venue-b");
    expect(ownershipQuery?.values).not.toContain("other");
  });

  it("rejects a cumulative over-refund before provider access", async () => {
    const manager = await token("manager");
    const response = await handlePaymentRoute(
      refundRequest(manager, {
        payment_id: "pay_owned",
        amount: 8_001,
        reason: "overcharge",
      }),
      env,
    );
    expect(response?.status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only the durable remaining amount and derives the actor server-side", async () => {
    const manager = await token("manager");
    const response = await handlePaymentRoute(
      refundRequest(manager, {
        payment_id: "pay_owned",
        reason: "customer_request",
        metadata: { refunded_by: "forged-client", caller: "dashboard" },
      }),
      env,
    );
    expect(response?.status).toBe(201);
    expect(await response?.json()).toMatchObject({
      payment_id: "pay_owned",
      amount: 8_000,
      status: "succeeded",
    });
    const providerRequest = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    const providerBody = JSON.parse(String(providerRequest.body)) as {
      amount: number;
      metadata: Record<string, unknown>;
    };
    expect(providerBody.amount).toBe(8_000);
    expect(providerBody.metadata).toMatchObject({
      caller: "dashboard",
      refunded_by: "manager@example.com",
    });
    expect(providerBody.metadata.refunded_by).not.toBe("forged-client");
    expect(h.ledger).toHaveLength(1);
  });

  it("returns pending without booking money when the provider has not settled", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ refund_id: "ref_pending_1", status: "pending" }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    const manager = await token("manager");
    const response = await handlePaymentRoute(refundRequest(manager), env);
    expect(response?.status).toBe(202);
    expect(await response?.json()).toMatchObject({ status: "pending" });
    expect(h.ledger).toHaveLength(0);
  });

  it("replays the same pending refund command without a second provider call", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ refund_id: "ref_pending_replay", status: "pending" }),
        {
          status: 202,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const manager = await token("manager");
    const first = await handlePaymentRoute(refundRequest(manager), env);
    const second = await handlePaymentRoute(refundRequest(manager), env);
    expect(first?.status).toBe(202);
    expect(second?.status).toBe(202);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains refund capacity when the provider outcome is ambiguous", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("connection reset"));
    const manager = await token("manager");
    const response = await handlePaymentRoute(refundRequest(manager), env);
    expect(response?.status).toBe(500);
    expect([...h.reservations.values()][0]?.status).toBe("unknown");
    const release = h.queries.find(
      (query) =>
        /UPDATE refund_reservations/.test(query.text) &&
        query.values.includes("failed"),
    );
    expect(release).toBeUndefined();
  });

  it("rejects changed refund inputs under the same idempotency key", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          refund_id: "ref_pending_conflict",
          status: "pending",
        }),
        {
          status: 202,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const manager = await token("manager");
    await handlePaymentRoute(refundRequest(manager), env);
    const conflict = await handlePaymentRoute(
      refundRequest(manager, {
        payment_id: "pay_owned",
        amount: 3_000,
        reason: "customer_request",
      }),
      env,
    );
    expect(conflict?.status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
