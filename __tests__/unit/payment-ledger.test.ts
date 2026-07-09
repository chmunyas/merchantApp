import { describe, it, expect, vi } from "vitest";

// A capturing stub Postgres client. `sql` is used as a tagged template
// (sql`...`) and also exposes `.json(...)`. Every query is captured so we can
// assert exactly what recordLedger writes — crucially, that a FAILED payment is
// persisted (status='failed') with its decline reason, "recorded clearly".
const h = vi.hoisted(() => {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve([] as unknown[]);
  }) as unknown as { (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>; json: (v: unknown) => unknown };
  sql.json = (v: unknown) => v;
  return { calls, sql };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

import { handlePaymentRoute } from "../../src/api/payments";

const SECRET = "whsec_test_0123456789abcdef0123456789abcdef";

async function hmacHex(payload: string, secret: string, hash: "SHA-256" | "SHA-512"): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
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

// The ledger INSERT is the one carrying the payments column list (unique to
// recordLedger — distinct from payment_events audit rows).
function ledgerInserts() {
  return h.calls.filter((c) => /tip_amount, staff_id, initiator/i.test(c.text));
}
function metaOf(rec: { values: unknown[] }): Record<string, unknown> | undefined {
  return rec.values.find(
    (v) => v && typeof v === "object" && "error_message" in (v as Record<string, unknown>),
  ) as Record<string, unknown> | undefined;
}

describe("payment ledger — failed payments are recorded clearly", () => {
  it("persists a signed payment_failed with status='failed' + the decline reason", async () => {
    h.calls.length = 0;
    const body = JSON.stringify({
      event_id: "evt_fail_1",
      event_type: "payment_failed",
      content: {
        object: {
          payment_id: "pay_fail_abcdefghij1234567890abcd",
          status: "failed",
          amount: 25000,
          currency: "KES",
          error_code: "R01",
          error_message: "Insufficient funds",
          metadata: { venue: "main", merchant_id: "main", customer_phone: "+254700111222" },
        },
      },
    });
    const sig = await hmacHex(body, SECRET, "SHA-512");
    const res = await handlePaymentRoute(webhookReq(body, { "x-webhook-signature-512": sig }), {
      PESASWAP_WEBHOOK_SECRET: SECRET,
    });
    expect(res!.status).toBe(200);

    const inserts = ledgerInserts();
    expect(inserts.length).toBe(1);
    const rec = inserts[0];
    // status column is written as 'failed' — the merchant's list shows the decline.
    expect(rec.values).toContain("failed");
    // ...and the decline reason is persisted in metadata (recorded clearly).
    const meta = metaOf(rec);
    expect(meta?.error_message).toBe("Insufficient funds");
    expect(meta?.error_code).toBe("R01");
  });

  it("never records an UNSIGNED (unverified) payment_failed — no forged declines", async () => {
    h.calls.length = 0;
    const body = JSON.stringify({
      event_type: "payment_failed",
      content: {
        object: {
          payment_id: "pay_forged_1",
          status: "failed",
          amount: 9999,
          currency: "KES",
          metadata: { venue: "main" },
        },
      },
    });
    const res = await handlePaymentRoute(webhookReq(body, {}), { PESASWAP_WEBHOOK_SECRET: SECRET });
    expect(res!.status).toBe(200);
    // Unverified webhooks are fast-ACKed and reconciled by pull — never written.
    expect(h.calls.length).toBe(0);
    expect(ledgerInserts().length).toBe(0);
  });

  it("persists a signed top-level payment_failed shape (live PesaSwap)", async () => {
    h.calls.length = 0;
    const body = JSON.stringify({
      payment_id: "pay_live_toplevel_fail_1234",
      status: "failed",
      amount: 5000,
      currency: "KES",
      error_code: "DECLINED",
      error_message: "Card declined by issuer",
      metadata: { venue: "main" },
    });
    const sig = await hmacHex(body, SECRET, "SHA-512");
    const res = await handlePaymentRoute(webhookReq(body, { "x-webhook-signature-512": sig }), {
      PESASWAP_WEBHOOK_SECRET: SECRET,
    });
    expect(res!.status).toBe(200);
    const inserts = ledgerInserts();
    expect(inserts.length).toBe(1);
    expect(inserts[0].values).toContain("failed");
    expect(metaOf(inserts[0])?.error_message).toBe("Card declined by issuer");
  });
});
