import { beforeAll, describe, expect, it } from "vitest";

// End-to-end flows from the customer/PWA surface through to the back office,
// hitting the exact HTTP endpoints the app uses. Requires the app running.
// Run: npm run test:e2e   (E2E_BASE_URL defaults to http://localhost:8080)

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const PASSWORD = "e2e-passw0rd";
const rnd = () => Math.random().toString(36).slice(2, 8);

type Tenant = { token: string; venue: string; email: string; plan?: string };
type Row = Record<string, unknown>;

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function signup(businessName: string): Promise<Tenant> {
  const email = `e2e-${rnd()}@e2e.test`;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessName, email, password: PASSWORD }),
  });
  const data = (await res.json()) as { token?: string; user?: Row; error?: string };
  if (!res.ok || !data.token || !data.user) {
    throw new Error(`signup failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return {
    token: data.token,
    venue: String(data.user.venue),
    email,
    plan: data.user.plan as string,
  };
}

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      `E2E server not reachable at ${BASE}. Start the app (docker compose up) or set E2E_BASE_URL.`,
    );
  }
  A = await signup("E2E Bistro A");
  B = await signup("E2E Cafe B");
});

describe("PWA -> back office E2E", () => {
  it("provisions a tenant on signup and lets it log in", async () => {
    expect(A.token).toBeTruthy();
    expect(A.venue).toMatch(/^v_/);
    expect(A.plan).toBe("free");

    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: A.email, password: PASSWORD }),
    });
    const data = (await res.json()) as { user?: Row };
    expect(res.status).toBe(200);
    expect(data.user?.role).toBe("merchant");
    expect(data.user?.venue).toBe(A.venue);
  });

  it("customer enquiry (PWA /enquire) lands in the back office", async () => {
    const guest = `E2E Guest ${rnd()}`;
    const post = await fetch(`${BASE}/api/enquiries?venue=${A.venue}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerName: guest,
        phone: "+254700000000",
        covers: 4,
        date: "2026-08-01",
        time: "19:30",
        notes: "e2e window seat",
      }),
    });
    expect(post.status).toBe(201);

    // Dashboard reads it with the tenant token.
    const list = await fetch(`${BASE}/api/enquiries?venue=${A.venue}`, {
      headers: authHeaders(A.token),
    });
    const data = (await list.json()) as { enquiries?: Row[] };
    const found = (data.enquiries ?? []).find((e) => e.customer_name === guest);
    expect(found).toBeTruthy();
    expect(found?.covers).toBe(4);
    expect(found?.source).toBe("web");
  });

  it("invoice created in the back office is payable via the public pay link", async () => {
    const customer = `E2E Payer ${rnd()}`;
    const create = await fetch(`${BASE}/api/invoices?venue=${A.venue}`, {
      method: "POST",
      headers: authHeaders(A.token),
      body: JSON.stringify({ customerName: customer, amount: 1500 }),
    });
    const inv = (await create.json()) as { number?: string };
    expect(create.status).toBe(201);
    expect(inv.number).toMatch(/^INV-/);

    const list = await fetch(`${BASE}/api/invoices?venue=${A.venue}`, {
      headers: authHeaders(A.token),
    });
    const listData = (await list.json()) as { invoices?: Row[] };
    expect(
      (listData.invoices ?? []).some((i) => i.number === inv.number),
    ).toBe(true);

    // Public pay page: /pay?i=INV-XXX -> /api/invoices/payinfo (no auth).
    const payinfo = await fetch(
      `${BASE}/api/invoices/payinfo?number=${inv.number}`,
    );
    const pay = (await payinfo.json()) as Row;
    expect(payinfo.status).toBe(200);
    expect(pay.amount).toBe(1500);
    expect(pay.till).toBe(inv.number);
  });

  it("web chat (PWA widget) shows up as a conversation in the inbox", async () => {
    const session = `e2e-sess-${rnd()}`;
    const chat = await fetch(`${BASE}/api/chat?venue=${A.venue}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        venue: A.venue,
        sessionId: session,
        name: "E2E Web User",
        text: "Hi, are you open tonight?",
      }),
    });
    expect(chat.status).toBe(200);

    const convs = await fetch(
      `${BASE}/api/whatsapp/conversations?venue=${A.venue}`,
      { headers: authHeaders(A.token) },
    );
    const data = (await convs.json()) as { conversations?: Row[] };
    const web = (data.conversations ?? []).find((c) => c.channel === "web");
    expect(web).toBeTruthy();
  });

  it("enforces tenant isolation across the API", async () => {
    const marker = `E2E-ISO-${rnd()}`;
    // Tenant A's token tries to write into tenant B via query + body tampering.
    await fetch(`${BASE}/api/invoices?venue=${B.venue}`, {
      method: "POST",
      headers: authHeaders(A.token),
      body: JSON.stringify({ customerName: marker, amount: 700, venue: B.venue }),
    });

    // A sees the row (pinned to A's venue); B never does.
    const aList = (await (
      await fetch(`${BASE}/api/invoices?venue=${B.venue}`, {
        headers: authHeaders(A.token),
      })
    ).json()) as { invoices?: Row[] };
    const bList = (await (
      await fetch(`${BASE}/api/invoices?venue=${A.venue}`, {
        headers: authHeaders(B.token),
      })
    ).json()) as { invoices?: Row[] };

    expect((aList.invoices ?? []).some((i) => i.customer_name === marker)).toBe(
      true,
    );
    expect((bList.invoices ?? []).some((i) => i.customer_name === marker)).toBe(
      false,
    );
  });
});
