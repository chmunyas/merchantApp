import { describe, expect, it } from "vitest";

import { clientIp } from "../../src/lib/rate-limit";
import {
  canGrantRole,
  canRemoveMember,
  planLimit,
  planLimitMessage,
  planOf,
  venueFromPayload,
} from "../../src/lib/tenancy";

describe("venueFromPayload (tenant isolation)", () => {
  const url = new URL("https://x/api/invoices?venue=queryVenue");

  it("prefers the JWT venue claim over the query param", () => {
    expect(venueFromPayload({ venue: "claimVenue" }, url)).toBe("claimVenue");
  });

  it("lets a platform admin (no venue claim) target a venue via the query param", () => {
    expect(venueFromPayload({ role: "admin" }, url)).toBe("queryVenue");
  });

  it("defaults to main when neither claim nor query is present", () => {
    expect(venueFromPayload(null, new URL("https://x/api/invoices"))).toBe(
      "main",
    );
  });

  it("pins a non-admin token with an invalid/absent claim to main (no ?venue= escalation)", () => {
    // Security (Alert 3): a non-admin principal cannot use ?venue= to reach
    // another tenant when its token carries no valid venue claim.
    expect(venueFromPayload({ venue: 123 } as never, url)).toBe("main");
    expect(venueFromPayload({ role: "merchant" }, url)).toBe("main");
  });
});

describe("planOf (tenant limits)", () => {
  it("returns a known plan", () => {
    expect(planOf({ plan: "free" })).toBe("free");
  });

  it("treats missing or unknown plans as uncapped (pro)", () => {
    expect(planOf(null)).toBe("pro");
    expect(planOf({ role: "merchant" })).toBe("pro");
    expect(planOf({ plan: "enterprise" })).toBe("pro");
  });
});

describe("planLimit (per-entity quotas)", () => {
  it("caps the free plan below pro across entities", () => {
    expect(planLimit("free", "staff")).toBeLessThan(planLimit("pro", "staff"));
    expect(planLimit("free", "menu_items")).toBe(50);
    expect(planLimit("free", "tables")).toBe(20);
    expect(planLimit("free", "stores")).toBe(2);
  });

  it("falls back to the pro cap for an unknown plan", () => {
    expect(planLimit("enterprise", "staff")).toBe(planLimit("pro", "staff"));
  });

  it("builds an upgrade message naming the entity + cap", () => {
    expect(planLimitMessage("free", "staff")).toMatch(/free plan/);
    expect(planLimitMessage("free", "staff")).toMatch(/5 team members/);
  });
});

describe("canGrantRole / canRemoveMember (multi-store RBAC)", () => {
  it("lets an owner grant any team role including owner", () => {
    expect(canGrantRole("merchant", "staff")).toBe(true);
    expect(canGrantRole("merchant", "manager")).toBe(true);
    expect(canGrantRole("merchant", "merchant")).toBe(true);
  });

  it("stops a manager from granting a higher (owner) role", () => {
    expect(canGrantRole("manager", "staff")).toBe(true);
    expect(canGrantRole("manager", "manager")).toBe(true);
    expect(canGrantRole("manager", "merchant")).toBe(false);
  });

  it("forbids sub-manager roles from granting anything", () => {
    expect(canGrantRole("supervisor", "staff")).toBe(false);
    expect(canGrantRole("staff", "staff")).toBe(false);
  });

  it("rejects unknown / platform roles as grant targets", () => {
    expect(canGrantRole("merchant", "admin")).toBe(false);
    expect(canGrantRole("merchant", "customer")).toBe(false);
    expect(canGrantRole("merchant", "wizard")).toBe(false);
  });

  it("never lets a member remove someone who outranks them", () => {
    expect(canRemoveMember("manager", "staff")).toBe(true);
    expect(canRemoveMember("manager", "manager")).toBe(true);
    expect(canRemoveMember("manager", "merchant")).toBe(false);
    expect(canRemoveMember("merchant", "merchant")).toBe(true);
    expect(canRemoveMember("staff", "staff")).toBe(false);
  });
});

describe("clientIp (rate limiting)", () => {
  it("prefers CF-Connecting-IP", () => {
    const request = new Request("https://x", {
      headers: {
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "9.9.9.9",
      },
    });
    expect(clientIp(request)).toBe("1.2.3.4");
  });

  it("falls back to the first X-Forwarded-For hop", () => {
    const request = new Request("https://x", {
      headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" },
    });
    expect(clientIp(request)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no client IP headers are present", () => {
    expect(clientIp(new Request("https://x"))).toBe("unknown");
  });
});
