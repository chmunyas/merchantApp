import { describe, expect, it } from "vitest";

import {
  ROUTE_POLICIES,
  decideRoute,
  matchRoutePath,
  normalizeApiPath,
  routePolicyResponse,
  routePolicyConflicts,
} from "../../src/lib/route-policy";
import { RULES } from "../../src/lib/rate-limit";
import { API_HANDLERS } from "../../src/server";

describe("central route policy", () => {
  it("has unique stable ids and no duplicate method/path declarations", () => {
    const ids = new Set<string>();
    const pairs = new Set<string>();
    for (const policy of ROUTE_POLICIES) {
      expect(ids.has(policy.id), `duplicate route id: ${policy.id}`).toBe(false);
      ids.add(policy.id);
      for (const method of policy.methods) {
        const key = `${method} ${policy.path}`;
        expect(pairs.has(key), `duplicate route declaration: ${key}`).toBe(false);
        pairs.add(key);
      }
    }
  });

  it("contains no ambiguous same-method route patterns", () => {
    expect(routePolicyConflicts()).toEqual([]);
  });

  it("has an executable handler for every policy handler key", () => {
    const policyHandlers = Array.from(
      new Set(ROUTE_POLICIES.map((policy) => policy.handler)),
    ).sort();
    expect(Object.keys(API_HANDLERS).sort()).toEqual(policyHandlers);
  });

  it("normalizes /api/v1 before matching", () => {
    expect(normalizeApiPath("/api/v1/payments/config")).toBe(
      "/api/payments/config",
    );
    expect(decideRoute("GET", "/api/v1/payments/config")).toMatchObject({
      kind: "match",
      route: { policy: { id: "payments.config" } },
    });
  });

  it("returns 404 for unknown API routes rather than falling through to SSR", () => {
    expect(decideRoute("GET", "/api/not-a-real-route")).toEqual({
      kind: "not-found",
    });
    const response = routePolicyResponse(
      new Request("https://merchant.test/api/not-a-real-route"),
    );
    expect(response?.status).toBe(404);
    expect(response?.headers.get("content-type")).toContain("application/json");
  });

  it("returns 405 and a generated Allow header for wrong methods", () => {
    const response = routePolicyResponse(
      new Request("https://merchant.test/api/health", { method: "POST" }),
    );
    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("GET");
  });

  it("generates preflight only for declared browser routes", () => {
    const declared = routePolicyResponse(
      new Request("https://merchant.test/api/a2a", { method: "OPTIONS" }),
      "https://merchant.test",
    );
    expect(declared?.status).toBe(204);
    expect(declared?.headers.get("allow")).toContain("POST");

    const unknown = routePolicyResponse(
      new Request("https://merchant.test/api/unknown", { method: "OPTIONS" }),
    );
    expect(unknown?.status).toBe(404);
  });

  it("rejects untrusted cross-origin preflight", () => {
    const response = routePolicyResponse(
      new Request("https://merchant.test/api/a2a", {
        method: "OPTIONS",
        headers: { origin: "https://evil.test" },
      }),
      null,
    );
    expect(response?.status).toBe(403);
    expect(response?.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("constrains invoice actions and generic channel ingress", () => {
    expect(decideRoute("POST", "/api/invoices/inv_1/void")).toMatchObject({
      kind: "match",
      route: { policy: { id: "invoices.action" } },
    });
    expect(decideRoute("POST", "/api/invoices/inv_1/promote-admin")).toEqual({
      kind: "not-found",
    });
    expect(decideRoute("POST", "/api/telegram/webhook")).toMatchObject({
      kind: "match",
      route: { policy: { id: "channels.webhook.receive" } },
    });
    expect(decideRoute("POST", "/api/wizard/webhook")).toEqual({
      kind: "not-found",
    });
  });

  it("enumerates only the supported WhatsApp bridge controls", () => {
    expect(decideRoute("GET", "/api/whatsapp/bridge/status")).toMatchObject({
      kind: "match",
    });
    expect(decideRoute("POST", "/api/whatsapp/bridge/logout")).toMatchObject({
      kind: "match",
    });
    expect(decideRoute("GET", "/api/whatsapp/bridge/send")).toEqual({
      kind: "not-found",
    });
  });

  it("classifies every sensitive policy as non-public", () => {
    const unsafe = ROUTE_POLICIES.filter(
      (policy) =>
        policy.sensitivity !== "public" &&
        policy.access === "public" &&
        ![
          "auth.login",
          "auth.signup",
          "auth.google",
          "auth.otp.request",
          "auth.otp.verify",
          "auth.staff-login",
          "sso.start",
          "sso.callback",
          "enquiries.create",
          "payments.create",
          "invoices.payinfo",
          "loyalty.status",
          "portal.token",
          "portal.token.verify",
          // A5.2 "I forgot to download my receipt" — a guest who has left the
          // venue has no session by definition. Both surfaces are unauthenticated
          // by necessity, so they are rate limited, fail closed, and answer
          // identically for a known and an unknown contact.
          "guest.receipt-lookup",
          "guest.receipt-lookup.verify",
          "reviews.create",
          // Google redirects the operator's browser here, so it cannot carry a
          // bearer token; the venue travels in a signed, short-lived state.
          "reviews.google.callback",
          "chat.send",
        ].includes(policy.id),
    ).map((policy) => policy.id);
    expect(unsafe).toEqual([]);
  });

  it("requires scopes on every PAT-enabled non-public route", () => {
    const missing = ROUTE_POLICIES.filter(
      (policy) =>
        policy.access === "human-or-api-token" &&
        (!policy.scopes || policy.scopes.length === 0),
    ).map((policy) => policy.id);
    expect(missing).toEqual([]);
  });

  it("matches dynamic parameters without accepting nested slashes", () => {
    const [route] = matchRoutePath("/api/payments/pay_123/status");
    expect(route.policy.id).toBe("payments.status");
    expect(route.params.id).toBe("pay_123");
    expect(matchRoutePath("/api/payments/a/b/status")).toEqual([]);
  });

  it("classifies verified customer payment history as financial data", () => {
    const policy = ROUTE_POLICIES.find((candidate) => candidate.id === "portal.read");
    expect(policy).toMatchObject({
      access: "customer-token",
      tenant: "resourceToken",
      sensitivity: "financial",
    });
  });

  it("routes staff PIN rotation only to the credential endpoint", () => {
    const staffId = "291c946b-d6c1-4121-a09a-e779eb9e68ba";
    expect(
      decideRoute("POST", `/api/staff/${staffId}/pin/reset`),
    ).toMatchObject({
      kind: "match",
      route: {
        policy: {
          id: "staff.pin.reset",
          handler: "staff",
          access: "human-only",
          minimumVenueRole: "manager",
          sensitivity: "credential",
        },
        params: { uuid: staffId },
      },
    });
    expect(
      routePolicyResponse(
        new Request(`https://merchant.test/api/staff/${staffId}/pin/reset`),
      )?.status,
    ).toBe(405);
    expect(
      decideRoute("POST", `/api/staff/${staffId}/pin/reset/extra`),
    ).toEqual({ kind: "not-found" });
  });

  it("rate-limits every high-risk public mutation and fails closed", () => {
    const rateIds = new Set(RULES.map((rule) => rule.id));
    const missing = ROUTE_POLICIES.filter(
      (policy) =>
        policy.access === "public" &&
        policy.methods.some((method) => method !== "GET") &&
        policy.sensitivity !== "public" &&
        !rateIds.has(policy.id),
    ).map((policy) => policy.id);
    expect(missing).toEqual([]);
    expect(RULES.every((rule) => rule.failClosed)).toBe(true);
  });
});
