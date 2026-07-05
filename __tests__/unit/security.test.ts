import { describe, expect, it } from "vitest";

import { clientIp } from "../../src/lib/rate-limit";
import { planOf, venueFromPayload } from "../../src/lib/tenancy";

describe("venueFromPayload (tenant isolation)", () => {
  const url = new URL("https://x/api/invoices?venue=queryVenue");

  it("prefers the JWT venue claim over the query param", () => {
    expect(venueFromPayload({ venue: "claimVenue" }, url)).toBe("claimVenue");
  });

  it("falls back to the query param when the token has no venue", () => {
    expect(venueFromPayload({ role: "admin" }, url)).toBe("queryVenue");
  });

  it("defaults to main when neither claim nor query is present", () => {
    expect(venueFromPayload(null, new URL("https://x/api/invoices"))).toBe(
      "main",
    );
  });

  it("ignores a non-string venue claim", () => {
    expect(venueFromPayload({ venue: 123 } as never, url)).toBe("queryVenue");
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
