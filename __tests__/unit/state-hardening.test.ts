import { describe, it, expect, vi } from "vitest";

// Auth + DB are mocked so we can exercise the /api/state guards directly. Auth
// always passes (venue "main"); getSql returns a truthy stub — the reject paths
// (400/413) return before any query runs.
vi.mock("../../src/api/auth", () => ({
  requireAuth: vi.fn(async () => ({ venue: "main", role: "merchant" })),
  requireHumanAuth: vi.fn(async () => ({
    kind: "human-jwt",
    sub: "owner@example.com",
    venue: "main",
    role: "merchant",
  })),
}));
vi.mock("../../src/lib/db", () => ({
  getSql: () => ({}) as unknown,
}));

import {
  containsPlaintextPin,
  handleStateRoute,
  isAllowedStateKey,
} from "../../src/api/state";

const post = (body: unknown) =>
  new Request("https://x.dev/api/state?venue=main", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("isAllowedStateKey", () => {
  it("accepts the two mirrored namespaces", () => {
    expect(isAllowedStateKey("fxengine.merchant.settings")).toBe(true);
    expect(isAllowedStateKey("fxengine.retail.products")).toBe(true);
    expect(isAllowedStateKey("pesaswap.services.data")).toBe(true);
  });

  it("rejects unknown, empty, oversized or non-string keys", () => {
    expect(isAllowedStateKey("evil.key")).toBe(false);
    expect(isAllowedStateKey("")).toBe(false);
    expect(isAllowedStateKey("x".repeat(201))).toBe(false);
    expect(isAllowedStateKey(42)).toBe(false);
    expect(isAllowedStateKey(null)).toBe(false);
  });
});

describe("/api/state hardening", () => {
  it("detects nested plaintext PIN fields", () => {
    expect(containsPlaintextPin({ staffMembers: [{ pin: "123456" }] })).toBe(true);
    expect(containsPlaintextPin({ staffMembers: [{ name: "Amina" }] })).toBe(false);
  });

  it("rejects plaintext PINs in otherwise allowed state", async () => {
    const res = await handleStateRoute(
      post({
        key: "fxengine.merchant.settings",
        value: { staffMembers: [{ pin: "123456" }] },
      }),
      {},
    );
    expect(res!.status).toBe(400);
  });
  it("rejects a key outside the mirrored namespaces with 400", async () => {
    const res = await handleStateRoute(post({ key: "attacker.blob", value: {} }), {});
    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toContain("unsupported");
  });

  it("rejects a missing key with 400", async () => {
    const res = await handleStateRoute(post({ value: {} }), {});
    expect(res!.status).toBe(400);
  });

  it("rejects an oversized value with 413", async () => {
    const huge = { blob: "a".repeat(4 * 1024 * 1024 + 10) };
    const res = await handleStateRoute(
      post({ key: "fxengine.merchant.settings", value: huge }),
      {},
    );
    expect(res!.status).toBe(413);
  });

  it("requires an optimistic concurrency revision", async () => {
    const res = await handleStateRoute(
      post({ key: "fxengine.merchant.settings", value: { theme: "dark" } }),
      {},
    );
    expect(res!.status).toBe(428);
    expect((await res!.json()).error).toContain("revision");
  });
});
