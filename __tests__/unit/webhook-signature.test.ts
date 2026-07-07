import { describe, it, expect } from "vitest";

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

function webhookRequest(body: string, headers: Record<string, string>): Request {
  return new Request("https://app.example.com/api/webhooks/pesaswap", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("PesaSwap webhook — signature + envelope", () => {
  // Live PesaSwap (Hyperswitch) shape: { event_type, event_id, content: { object } }
  // with underscore event names and HMAC-SHA512 in x-webhook-signature-512.
  const liveBody = JSON.stringify({
    event_id: "evt_live_123",
    event_type: "payment_succeeded",
    content: {
      object: {
        payment_id: "pay_live_abcdefghij1234567890abcd",
        status: "succeeded",
        amount: 15000,
        currency: "KES",
        payment_method: "card",
        payment_method_id: "pm_live_visa_4242",
        payment_method_type: "credit",
        payment_method_data: { card: { last4: "4242", card_network: "Visa" } },
        metadata: { customer_phone: "+254700111222", merchant_id: "main", venue: "main" },
      },
    },
  });

  it("accepts a live payment_succeeded with a valid SHA-512 signature", async () => {
    const sig = await hmacHex(liveBody, SECRET, "SHA-512");
    const res = await handlePaymentRoute(
      webhookRequest(liveBody, { "x-webhook-signature-512": sig }),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ received: true });
  });

  it("accepts uppercase hex signatures (case-insensitive)", async () => {
    const sig = (await hmacHex(liveBody, SECRET, "SHA-512")).toUpperCase();
    const res = await handlePaymentRoute(
      webhookRequest(liveBody, { "x-webhook-signature-512": sig }),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res!.status).toBe(200);
  });

  it("rejects a tampered body (bad SHA-512 signature) with 401", async () => {
    const sig = await hmacHex(liveBody, SECRET, "SHA-512");
    const res = await handlePaymentRoute(
      webhookRequest(liveBody + " ", { "x-webhook-signature-512": sig }),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res!.status).toBe(401);
  });

  it("rejects a signature made with the wrong secret with 401", async () => {
    const sig = await hmacHex(liveBody, "the-wrong-secret", "SHA-512");
    const res = await handlePaymentRoute(
      webhookRequest(liveBody, { "x-webhook-signature-512": sig }),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res!.status).toBe(401);
  });

  it("fails closed (503) when the webhook secret is not configured", async () => {
    const sig = await hmacHex(liveBody, SECRET, "SHA-512");
    const res = await handlePaymentRoute(
      webhookRequest(liveBody, { "x-webhook-signature-512": sig }),
      {},
    );
    expect(res!.status).toBe(503);
  });

  it("rejects a webhook with no signature header with 401", async () => {
    const res = await handlePaymentRoute(
      webhookRequest(liveBody, {}),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res!.status).toBe(401);
  });

  it("still accepts the legacy simulator shape via x-webhook-signature-256", async () => {
    const legacyBody = JSON.stringify({
      type: "payment.succeeded",
      data: {
        payment_id: "pay_sim_1234567890abcdefghij1234",
        amount: 5000,
        currency: "KES",
        metadata: { customer_phone: "+254700333444", merchant_id: "main" },
      },
    });
    const sig = await hmacHex(legacyBody, SECRET, "SHA-256");
    const res = await handlePaymentRoute(
      webhookRequest(legacyBody, { "x-webhook-signature-256": sig }),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ received: true });
  });

  it("acknowledges (200) an unhandled but authentic event type", async () => {
    const body = JSON.stringify({ event_type: "dispute_opened", content: { object: { payment_id: "x" } } });
    const sig = await hmacHex(body, SECRET, "SHA-512");
    const res = await handlePaymentRoute(
      webhookRequest(body, { "x-webhook-signature-512": sig }),
      { PESASWAP_WEBHOOK_SECRET: SECRET },
    );
    expect(res!.status).toBe(200);
  });
});
