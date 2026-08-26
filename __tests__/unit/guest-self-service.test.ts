import { beforeEach, describe, expect, it, vi } from "vitest";

// A5.2 / A5.4 / A5.6 — guest self-service.
//
// The three properties pinned here are the ones that are easy to lose in a
// refactor and expensive to lose in production:
//
//   1. The public receipt lookup is not a user-enumeration oracle. Known and
//      unknown contacts get byte-identical responses (bar the random challenge
//      id), and only a known contact triggers a message.
//   2. Every public identity surface is rate limited, and the limiter fails
//      CLOSED — if we cannot count attempts, we do not hand out codes.
//   3. A guest can ASK for a refund and can never CAUSE one. `/api/refunds`
//      stays manager+ and untouched, approving a request moves no money, and a
//      request cannot claim to be refunded without a real refund payment id.
//
// Plus: the redaction that backs an erasure actually redacts.

const h = vi.hoisted(() => {
  const queries: string[] = [];
  const state = {
    knownPhone: "+254712345678",
    knownEmail: "guest@example.com",
    otpValid: true,
    refundExists: false,
    dataRequest: {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "erasure",
      status: "received",
      subject_phone: "+254712345678",
      contact_id: "22222222-2222-4222-8222-222222222222",
    } as Record<string, unknown> | null,
  };

  function run(text: string, values: unknown[]): unknown[] {
    queries.push(text);

    if (/SELECT 1 FROM payments/i.test(text)) {
      return String(values[1]) === state.knownPhone ? [{ "?column?": 1 }] : [];
    }
    if (/SELECT phone FROM contacts/i.test(text)) {
      return String(values[1]) === state.knownEmail
        ? [{ phone: state.knownPhone }]
        : [];
    }
    if (/SELECT id, code_hash, attempts FROM auth_otps/i.test(text)) {
      return state.otpValid ? [{ id: "otp_1", code_hash: "x", attempts: 0 }] : [];
    }
    if (/SELECT r\.id FROM payments r/i.test(text)) {
      return state.refundExists ? [{ id: "pay_refund_1" }] : [];
    }
    if (/UPDATE guest_refund_requests/i.test(text)) {
      return [
        {
          id: "33333333-3333-4333-8333-333333333333",
          status: String(values[0]),
          refund_payment_id: null,
          decided_at: "2026-08-24T00:00:00.000Z",
        },
      ];
    }
    if (/SELECT id, kind, status, subject_phone, contact_id/i.test(text)) {
      return state.dataRequest ? [state.dataRequest] : [];
    }
    if (/UPDATE guest_data_requests/i.test(text)) {
      return [
        {
          id: "11111111-1111-4111-8111-111111111111",
          status: String(values[0]),
          completed_at: null,
        },
      ];
    }
    if (/UPDATE contacts/i.test(text)) return [{ id: "contact_1" }];
    if (/SELECT id, metadata FROM payments/i.test(text)) {
      return [
        {
          id: "pay_1",
          metadata: {
            customer_phone: state.knownPhone,
            customer_name: "Amina W.",
            order_id: "order-9",
            provider_ref: "REF123",
          },
        },
      ];
    }
    return [];
  }

  type Tag = ((s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>) & {
    begin: <T>(cb: (tx: Tag) => Promise<T> | T) => Promise<T>;
  };

  const sql = ((s: TemplateStringsArray, ...v: unknown[]) =>
    Promise.resolve(run(s.join("?"), v))) as Tag;
  sql.begin = async (cb) => cb(sql);

  return { sql, queries, state };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql };
});

vi.mock("../../src/api/auth", () => ({
  getOtpPepper: vi.fn(async () => "pepper"),
  requireHumanAuth: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("../../src/lib/outbound-jobs", () => ({
  queueOutbound: vi.fn(async () => ({ id: "d1", queued: true })),
  hasVerifiedChannelAccount: vi.fn(async () => true),
}));

vi.mock("../../src/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimit: vi.fn(async () => ({ limited: false, remaining: 5, retryAfter: 0 })),
    clientIp: () => "203.0.113.7",
  };
});

vi.mock("../../src/lib/runtime-security", () => ({
  otpDebugAllowed: () => false,
}));

vi.mock("../../src/lib/otp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/otp")>();
  return { ...actual, timingSafeEqualHex: () => true };
});

import { requireHumanAuth } from "../../src/api/auth";
import { handleGuestRoute } from "../../src/api/guest";
import {
  REDACTED_NAME,
  containsIdentifier,
  redactContactFields,
  redactPaymentMetadata,
} from "../../src/lib/guest-privacy";
import { queueOutbound } from "../../src/lib/outbound-jobs";
import { RULES, rateLimit } from "../../src/lib/rate-limit";
import { ROUTE_POLICIES, decideRoute } from "../../src/lib/route-policy";

const KNOWN = "+254712345678";
const UNKNOWN = "+254799999999";

function lookup(contact: string, channel = "sms") {
  return handleGuestRoute(
    new Request("https://merchant.test/api/guest/receipt-lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venue: "v_1", channel, contact }),
    }),
    {},
  );
}

function policy(id: string) {
  const found = ROUTE_POLICIES.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing policy ${id}`);
  return found;
}

beforeEach(() => {
  h.queries.length = 0;
  h.state.otpValid = true;
  h.state.refundExists = false;
  h.state.dataRequest = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "erasure",
    status: "received",
    subject_phone: KNOWN,
    contact_id: "22222222-2222-4222-8222-222222222222",
  };
  vi.mocked(requireHumanAuth).mockReset();
  vi.mocked(queueOutbound).mockClear();
  vi.mocked(rateLimit).mockReset();
  vi.mocked(rateLimit).mockResolvedValue({
    limited: false,
    remaining: 5,
    retryAfter: 0,
  });
});

describe("A5.2 receipt lookup — anti-enumeration", () => {
  it("answers identically for a known and an unknown contact", async () => {
    const known = await lookup(KNOWN);
    const unknown = await lookup(UNKNOWN);

    expect(known!.status).toBe(unknown!.status);
    expect(known!.status).toBe(202);

    const a = (await known!.json()) as Record<string, unknown>;
    const b = (await unknown!.json()) as Record<string, unknown>;

    // Same keys, same order, same values — except the random challenge id and
    // the guest's own masked input, which are echoes of the request, not facts
    // about the venue's data.
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(a.sent).toBe(b.sent);
    expect(a.channel).toBe(b.channel);
    expect(a.expiresIn).toBe(b.expiresIn);
    expect(a).not.toHaveProperty("devCode");
    expect(String(a.challengeId)).toMatch(/^otp_[0-9a-f]{32}$/);
    expect(a.challengeId).not.toBe(b.challengeId);
  });

  it("never leaks existence through the masked destination", async () => {
    const res = await lookup(UNKNOWN);
    const body = (await res!.json()) as { maskedDestination: string };
    // The mask is derived from what the guest typed, so it cannot disclose a
    // stored value.
    expect(body.maskedDestination).toBe("+254••••99");
  });

  it("creates the OTP challenge for both, but only messages a real guest", async () => {
    await lookup(KNOWN);
    expect(vi.mocked(queueOutbound)).toHaveBeenCalledTimes(1);
    expect(h.queries.filter((q) => /INSERT INTO auth_otps/i.test(q))).toHaveLength(
      1,
    );

    h.queries.length = 0;
    vi.mocked(queueOutbound).mockClear();
    await lookup(UNKNOWN);
    expect(vi.mocked(queueOutbound)).not.toHaveBeenCalled();

    // …and the challenge row was still written, so verify behaves the same way.
    expect(h.queries.filter((q) => /INSERT INTO auth_otps/i.test(q))).toHaveLength(
      1,
    );
  });

  it("swallows a dispatch failure rather than turning it into an oracle", async () => {
    vi.mocked(queueOutbound).mockRejectedValueOnce(new Error("channel down"));
    const res = await lookup(KNOWN);
    expect(res!.status).toBe(202);
    const body = (await res!.json()) as { sent: boolean };
    expect(body.sent).toBe(true);
  });

  it("rejects a malformed contact on syntax alone, before any lookup", async () => {
    const res = await lookup("not-a-number", "email");
    expect(res!.status).toBe(400);
    expect(h.queries.some((q) => /FROM payments/i.test(q))).toBe(false);
  });

  it("resolves an email identity through the contact record", async () => {
    await lookup("guest@example.com", "email");
    expect(h.queries.some((q) => /SELECT phone FROM contacts/i.test(q))).toBe(true);
    expect(vi.mocked(queueOutbound)).toHaveBeenCalledTimes(1);
  });
});

describe("A5.2 receipt lookup — rate limiting", () => {
  it("fails closed with 503 when the limiter is unavailable", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      limited: false,
      remaining: 0,
      retryAfter: 0,
      unavailable: true,
    });
    const res = await lookup(KNOWN);
    expect(res!.status).toBe(503);
    // No code was minted and nothing was sent.
    expect(h.queries.some((q) => /INSERT INTO auth_otps/i.test(q))).toBe(false);
    expect(vi.mocked(queueOutbound)).not.toHaveBeenCalled();
  });

  it("429s a destination that has already asked too often", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      limited: true,
      remaining: 0,
      retryAfter: 900,
    });
    const res = await lookup(KNOWN);
    expect(res!.status).toBe(429);
  });

  it("fails closed on the verify step too", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      limited: false,
      remaining: 0,
      retryAfter: 0,
      unavailable: true,
    });
    const res = await handleGuestRoute(
      new Request("https://merchant.test/api/guest/receipt-lookup/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: "otp_1",
          venue: "v_1",
          channel: "sms",
          contact: KNOWN,
          code: "123456",
        }),
      }),
      {},
    );
    expect(res!.status).toBe(503);
  });

  it("declares a per-IP rule for every public guest surface", () => {
    for (const id of [
      "guest.venue",
      "guest.receipt-lookup",
      "guest.receipt-lookup.verify",
      "portal.refund-request",
      "portal.data-request",
    ]) {
      const rule = RULES.find((r) => r.id === id);
      expect(rule, `missing rate-limit rule ${id}`).toBeDefined();
      expect(rule!.failClosed).toBe(true);
    }
  });
});

describe("A5.4 refund requests — the guest may ask, never move money", () => {
  const manager = { kind: "human-jwt", sub: "m@example.com", role: "manager", venue: "v_1" };
  const staff = { kind: "human-jwt", sub: "s@example.com", role: "staff", venue: "v_1" };

  function patchRefund(payload: unknown, body: unknown) {
    vi.mocked(requireHumanAuth).mockResolvedValue(payload as never);
    return handleGuestRoute(
      new Request(
        "https://merchant.test/api/refund-requests/33333333-3333-4333-8333-333333333333",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      {},
    );
  }

  it("keeps POST /api/refunds manager+ and financial — unchanged by this work", () => {
    const refund = policy("payments.refund");
    expect(refund.minimumVenueRole).toBe("manager");
    expect(refund.scopes).toEqual(["payments:write"]);
    expect(refund.sensitivity).toBe("financial");
  });

  it("denies a server the decision queue", async () => {
    const res = await patchRefund(staff, { status: "approved" });
    expect(res!.status).toBe(403);
  });

  it("denies an anonymous caller", async () => {
    const res = await patchRefund(null, { status: "approved" });
    expect(res!.status).toBe(401);
  });

  it("lets a manager approve — and moves no money doing it", async () => {
    const res = await patchRefund(manager, { status: "approved" });
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { requiresManualRefund: boolean };
    expect(body.requiresManualRefund).toBe(true);
    // Nothing was inserted into payments, and no refund was reserved.
    expect(h.queries.some((q) => /INSERT INTO payments/i.test(q))).toBe(false);
    expect(h.queries.some((q) => /payment_refunds|refund_reservations/i.test(q))).toBe(
      false,
    );
  });

  it("refuses to mark a request refunded without a real refund payment", async () => {
    h.state.refundExists = false;
    const res = await patchRefund(manager, {
      status: "refunded",
      refundPaymentId: "pay_made_up",
    });
    expect(res!.status).toBe(400);
  });

  it("accepts refunded only once the refund exists on the same payment", async () => {
    h.state.refundExists = true;
    const res = await patchRefund(manager, {
      status: "refunded",
      refundPaymentId: "pay_refund_1",
    });
    expect(res!.status).toBe(200);
  });

  it("rejects a status outside the declared lifecycle", async () => {
    const res = await patchRefund(manager, { status: "succeeded" });
    expect(res!.status).toBe(400);
  });

  it("declares the guest-side request as a customer-token route", () => {
    const guestSide = policy("portal.refund-request");
    expect(guestSide.access).toBe("customer-token");
    expect(guestSide.tenant).toBe("resourceToken");
    expect(decideRoute("POST", "/api/portal/abc123/refund-request")).toMatchObject({
      kind: "match",
      route: { policy: { id: "portal.refund-request" } },
    });
  });
});

describe("A5.6 data requests — erasure is bounded and owner-gated", () => {
  const manager = { kind: "human-jwt", sub: "m@example.com", role: "manager", venue: "v_1" };
  const owner = { kind: "human-jwt", sub: "o@example.com", role: "merchant", venue: "v_1" };

  function patchData(payload: unknown, body: unknown) {
    vi.mocked(requireHumanAuth).mockResolvedValue(payload as never);
    return handleGuestRoute(
      new Request(
        "https://merchant.test/api/data-requests/11111111-1111-4111-8111-111111111111",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
      {},
    );
  }

  it("lets a manager triage but not complete an erasure", async () => {
    expect((await patchData(manager, { status: "in_review" }))!.status).toBe(200);
    expect((await patchData(manager, { status: "completed" }))!.status).toBe(403);
  });

  it("lets the owner complete an erasure and reports what was redacted", async () => {
    const res = await patchData(owner, { status: "completed" });
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      redacted: { contacts: number; payments: number } | null;
    };
    expect(body.redacted).toEqual({ contacts: 1, payments: 1 });
  });

  it("never deletes a financial row while completing an erasure", async () => {
    await patchData(owner, { status: "completed" });
    expect(
      h.queries.some((q) =>
        /DELETE FROM (payments|invoices|journal|ledger|tips)/i.test(q),
      ),
    ).toBe(false);
    // Payment rows are UPDATEd (metadata only) and amounts are untouched.
    const paymentUpdates = h.queries.filter((q) =>
      /UPDATE payments SET metadata/i.test(q),
    );
    expect(paymentUpdates).toHaveLength(1);
    expect(paymentUpdates[0]).not.toMatch(/amount|status|currency/i);
  });

  it("writes an audit event for every transition", async () => {
    await patchData(manager, { status: "in_review" });
    expect(
      h.queries.some((q) => /INSERT INTO guest_data_request_events/i.test(q)),
    ).toBe(true);
  });

  it("refuses to re-complete a completed request", async () => {
    h.state.dataRequest = {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "erasure",
      status: "completed",
      subject_phone: KNOWN,
      contact_id: null,
    };
    const res = await patchData(owner, { status: "completed" });
    expect(res!.status).toBe(409);
  });
});

describe("A5.6 redaction — verifiable, not aspirational", () => {
  it("strips every identifier from a contact record", () => {
    const redacted = redactContactFields({
      name: "Amina Wanjiru",
      phone: KNOWN,
      email: "amina@example.com",
      notes: "Allergic to shellfish; sits at 12",
      tags: ["vip", "regular"],
    });
    expect(redacted.name).toBe(REDACTED_NAME);
    expect(redacted.phone).toBeNull();
    expect(redacted.email).toBeNull();
    expect(redacted.notes).toBeNull();
    expect(redacted.tags).toEqual([]);
    expect(containsIdentifier(redacted, "Amina Wanjiru")).toBe(false);
    expect(containsIdentifier(redacted, KNOWN)).toBe(false);
    expect(containsIdentifier(redacted, "amina@example.com")).toBe(false);
  });

  it("strips identity from payment metadata but keeps the money facts", () => {
    const before = {
      customer_phone: KNOWN,
      customer_name: "Amina Wanjiru",
      customerEmail: "amina@example.com",
      order_id: "order-9",
      provider_ref: "REF123",
      fee_amount: 250,
    };
    const after = redactPaymentMetadata(before, "2026-08-24T10:00:00.000Z");

    expect(containsIdentifier(after, KNOWN)).toBe(false);
    expect(containsIdentifier(after, "0712345678")).toBe(false);
    expect(containsIdentifier(after, "Amina Wanjiru")).toBe(false);
    expect(containsIdentifier(after, "amina@example.com")).toBe(false);

    expect(after.order_id).toBe("order-9");
    expect(after.provider_ref).toBe("REF123");
    expect(after.fee_amount).toBe(250);
    expect(after.pii_redacted_at).toBe("2026-08-24T10:00:00.000Z");
  });

  it("does not mutate the input", () => {
    const before = { customer_phone: KNOWN };
    redactPaymentMetadata(before, "2026-08-24T10:00:00.000Z");
    expect(before.customer_phone).toBe(KNOWN);
  });

  it("catches a phone that survived in a different format", () => {
    expect(containsIdentifier({ note: "call 0712 345 678" }, KNOWN)).toBe(true);
  });
});

describe("route policy declarations for guest self-service", () => {
  it("classifies the public lookup as PII and the verify as credential", () => {
    expect(policy("guest.receipt-lookup")).toMatchObject({
      access: "public",
      tenant: "publicSelector",
      sensitivity: "pii",
    });
    expect(policy("guest.receipt-lookup.verify")).toMatchObject({
      access: "public",
      sensitivity: "credential",
    });
  });

  it("keeps both merchant queues human-only and manager+", () => {
    for (const id of [
      "guest.refund-requests.list",
      "guest.refund-requests.decide",
      "guest.data-requests.list",
      "guest.data-requests.decide",
    ]) {
      expect(policy(id).access).toBe("human-only");
      expect(policy(id).minimumVenueRole).toBe("manager");
      expect(policy(id).scopes).toBeUndefined();
    }
  });

  it("routes the new paths to the guest handler", () => {
    expect(decideRoute("POST", "/api/guest/receipt-lookup")).toMatchObject({
      kind: "match",
      route: { policy: { handler: "guest" } },
    });
    expect(
      decideRoute("PATCH", "/api/data-requests/11111111-1111-4111-8111-111111111111"),
    ).toMatchObject({ kind: "match", route: { policy: { handler: "guest" } } });
  });

  it("refuses the wrong method rather than falling through to SSR", () => {
    expect(decideRoute("GET", "/api/guest/receipt-lookup")).toMatchObject({
      kind: "method-not-allowed",
    });
  });
});
