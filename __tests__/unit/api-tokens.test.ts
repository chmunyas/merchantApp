import { describe, it, expect } from "vitest";

import {
  API_SCOPES,
  capTokenRole,
  generateApiToken,
  hashToken,
  isValidScope,
  tokenHasScope,
} from "../../src/lib/api-tokens";

describe("api-tokens", () => {
  it("mints pat_ tokens with a display prefix + matching hash", async () => {
    const t = await generateApiToken();
    expect(t.token).toMatch(/^pat_[0-9a-f]{40}$/);
    expect(t.prefix).toBe(t.token.slice(0, 12));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(t.token)).toBe(t.hash);
  });

  it("hashes deterministically (SHA-256)", async () => {
    expect(await hashToken("pat_abc")).toBe(await hashToken("pat_abc"));
    expect(await hashToken("pat_abc")).not.toBe(await hashToken("pat_abd"));
  });

  it("caps the token role at manager (no owner/admin escalation)", () => {
    expect(capTokenRole("manager")).toBe("manager");
    expect(capTokenRole("supervisor")).toBe("supervisor");
    expect(capTokenRole("merchant")).toBe("staff");
    expect(capTokenRole("admin")).toBe("staff");
    expect(capTokenRole(undefined)).toBe("staff");
  });

  it("validates scopes against the catalogue", () => {
    expect(isValidScope("orders:read")).toBe(true);
    expect(isValidScope("payments:write")).toBe(true);
    expect(isValidScope("nope")).toBe(false);
    expect(API_SCOPES).toContain("agent");
  });

  it("tokenHasScope constrains only API-token principals; `agent` implies all", () => {
    // A human JWT (no isApiToken) is governed by role, not scopes → always true.
    expect(tokenHasScope({ role: "manager" }, "payments:read")).toBe(true);
    // An API token is limited to its granted scopes.
    expect(tokenHasScope({ isApiToken: true, scopes: ["payments:read"] }, "payments:read")).toBe(true);
    expect(tokenHasScope({ isApiToken: true, scopes: ["orders:read"] }, "payments:read")).toBe(false);
    // The blanket `agent` scope implies every scope.
    expect(tokenHasScope({ isApiToken: true, scopes: ["agent"] }, "payments:write")).toBe(true);
    expect(tokenHasScope(null, "agent")).toBe(true);
  });
});
