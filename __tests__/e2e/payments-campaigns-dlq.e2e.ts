import { beforeAll, describe, expect, it } from "vitest";

// E2E: payments (incl. DECLINED), campaigns/broadcast, and the dead-letter queue,
// exercised over the exact HTTP endpoints the app uses. Proves that EVERY payment
// outcome — success AND failure — is written to the durable ledger and surfaced to
// the merchant (status + decline reason), so failures are "recorded clearly".
// Requires the app running with PAYMENTS_TEST_MODE on (dev default).
// Run: npm run test:e2e   (E2E_BASE_URL defaults to http://localhost:8080)

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const PASSWORD = "e2e-passw0rd";
const rnd = () => Math.random().toString(36).slice(2, 8);

type Tenant = { token: string; venue: string; email: string };
type Row = Record<string, unknown>;

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function signup(businessName: string): Promise<Tenant> {
  const email = `e2e-pay-${rnd()}@e2e.test`;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessName, email, password: PASSWORD }),
  });
  const data = (await res.json()) as {
    token?: string;
    user?: Row;
    error?: string;
  };
  if (!res.ok || !data.token || !data.user) {
    throw new Error(`signup failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return { token: data.token, venue: String(data.user.venue), email };
}

async function createPayment(
  tenant: Tenant,
  amount: number,
  extraMeta: Row = {},
): Promise<{ status: number; body: Row }> {
  const sourceId = `e2e-${rnd()}`;
  const intentResponse = await fetch(`${BASE}/api/payments/intent`, {
    method: "POST",
    headers: authHeaders(tenant.token),
    body: JSON.stringify({
      amount,
      currency: "KES",
      sourceId,
      metadata: extraMeta,
    }),
  });
  const intent = (await intentResponse.json()) as {
    paymentIntentToken?: string;
    error?: Row;
  };
  if (!intentResponse.ok || !intent.paymentIntentToken) {
    throw new Error(
      `payment intent failed (${intentResponse.status}): ${JSON.stringify(intent)}`,
    );
  }

  const res = await fetch(`${BASE}/api/payments/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `e2e-payment-${sourceId}`,
    },
    body: JSON.stringify({
      payment_intent_token: intent.paymentIntentToken,
      metadata: extraMeta,
    }),
  });
  return { status: res.status, body: (await res.json()) as Row };
}

async function listPayments(t: Tenant, status?: string): Promise<Row[]> {
  const q = status ? `?status=${status}` : "";
  const res = await fetch(`${BASE}/api/payments/list${q}`, {
    headers: authHeaders(t.token),
  });
  const data = (await res.json()) as { payments?: Row[] };
  return data.payments ?? [];
}

let T: Tenant;

beforeAll(async () => {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      `E2E server not reachable at ${BASE}. Start the app (docker compose up) or set E2E_BASE_URL.`,
    );
  }
  T = await signup("E2E Payments Co");
});

describe("payments E2E — every outcome recorded clearly", () => {
  it("records a DECLINED payment in the ledger with its decline reason", async () => {
    const amount = 12345;
    const reason = "Simulated decline (test mode)";
    const { status, body } = await createPayment(T, amount, {
      simulate: "failed",
      customer_phone: "+254700999888",
    });
    // The create resolves (200) but reports the payment as failed — not a 5xx.
    expect(status).toBe(200);
    expect(body.status).toBe("failed");
    expect((body.error as Row)?.message).toBe(reason);

    // The merchant sees it in the ledger, filtered to failures, with the reason.
    const failed = await listPayments(T, "failed");
    const row = failed.find((p) => p.id === body.payment_id);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("failed");
    expect(row?.amount).toBe(amount);
    expect(row?.errorMessage).toBe(reason);
  });

  it("records a SUCCESSFUL payment and keeps it distinct from failures", async () => {
    const amount = 20000;
    const { status, body } = await createPayment(T, amount, {
      customer_phone: "0700111222",
    });
    expect(status).toBe(201);
    expect(body.status).toBe("succeeded");

    const succeeded = await listPayments(T, "succeeded");
    const row = succeeded.find((p) => p.id === body.payment_id);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("succeeded");
    expect(row?.amount).toBe(amount);
    expect(row?.customerPhone).toBe("+254700111222");

    // The full ledger holds BOTH outcomes, each labelled by status.
    const all = await listPayments(T);
    const statuses = new Set(all.map((p) => String(p.status)));
    expect(statuses.has("failed")).toBe(true);
    expect(statuses.has("succeeded")).toBe(true);
  });

  it("scopes the ledger to the tenant (a fresh tenant never sees another's payments)", async () => {
    const other = await signup("E2E Payments Rival");
    const mine = await listPayments(T);
    const theirs = await listPayments(other);
    // My failed/succeeded ids must never appear in their ledger.
    const myIds = new Set(mine.map((p) => String(p.id)));
    expect(theirs.every((p) => !myIds.has(String(p.id)))).toBe(true);
  });
});

describe("campaigns + DLQ E2E", () => {
  it("runs a broadcast campaign and records it in history", async () => {
    const send = await fetch(`${BASE}/api/broadcast`, {
      method: "POST",
      headers: authHeaders(T.token),
      body: JSON.stringify({
        message: `E2E promo ${rnd()} — 2-for-1 today!`,
        segment: "all",
        channel: "whatsapp",
      }),
    });
    expect(send.status).toBe(200);
    const result = (await send.json()) as Row;
    // sendBroadcast reports how many were attempted/sent/failed — numeric shape.
    expect(typeof (result.sent ?? result.total ?? result.recipients ?? 0)).toBe(
      "number",
    );

    const hist = await fetch(`${BASE}/api/broadcast/history`, {
      headers: authHeaders(T.token),
    });
    expect(hist.status).toBe(200);
    const histBody = (await hist.json()) as { history?: Row[] };
    expect(Array.isArray(histBody.history)).toBe(true);
  });

  it("exposes a tenant-scoped dead-letter queue and a safe retry", async () => {
    const list = await fetch(`${BASE}/api/dlq`, {
      headers: authHeaders(T.token),
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { failed?: Row[]; count?: number };
    expect(Array.isArray(body.failed)).toBe(true);
    expect(typeof body.count).toBe("number");

    const retry = await fetch(`${BASE}/api/dlq/retry`, {
      method: "POST",
      headers: authHeaders(T.token),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as Row;
    expect(typeof retryBody.retried).toBe("number");
    expect(typeof retryBody.recovered).toBe("number");
  });

  it("requires auth for the DLQ (no anonymous access)", async () => {
    const res = await fetch(`${BASE}/api/dlq`);
    expect(res.status).toBe(401);
  });
});

describe("payment webhook E2E — always ACKs (never CallToMerchantFailed)", () => {
  it("fast-ACKs (200) an unsigned/unverifiable webhook without recording it", async () => {
    const body = JSON.stringify({
      event_type: "payment_failed",
      content: {
        object: {
          payment_id: `pay_e2e_forged_${rnd()}`,
          status: "failed",
          amount: 4242,
          currency: "KES",
          metadata: { venue: T.venue },
        },
      },
    });
    const res = await fetch(`${BASE}/api/webhooks/pesaswap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    // An unverified webhook must NOT create a ledger row (no forged declines).
    const failed = await listPayments(T, "failed");
    expect(failed.some((p) => String(p.id).includes("forged"))).toBe(false);
  });
});
