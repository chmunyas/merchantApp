import { describe, expect, it } from "vitest";

import { withSecurityHeaders } from "../../src/server";

describe("central security headers", () => {
  it("applies CSP and no-store/no-referrer to payment documents", async () => {
    const request = new Request("https://merchant.test/pay?r=secret");
    const response = withSecurityHeaders(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
      request,
      { CORS_ALLOWED_ORIGIN: "https://merchant.test" },
      "request-id",
    );
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});