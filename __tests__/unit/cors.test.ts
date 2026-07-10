import { describe, it, expect } from "vitest";

import { resolveCorsOrigin } from "../../src/lib/cors";

function req(origin?: string): Request {
  const h = new Headers();
  if (origin) h.set("origin", origin);
  return new Request("https://app.example.com/api/x", { headers: h });
}

describe("resolveCorsOrigin", () => {
  it("returns null (keeps open '*') when CORS_ALLOWED_ORIGIN is unset", () => {
    expect(resolveCorsOrigin(req("https://a.com"), {})).toBeNull();
    expect(resolveCorsOrigin(req("https://a.com"), { CORS_ALLOWED_ORIGIN: "" })).toBeNull();
  });

  it("returns '*' when explicitly configured to allow all", () => {
    expect(resolveCorsOrigin(req("https://a.com"), { CORS_ALLOWED_ORIGIN: "*" })).toBe("*");
  });

  it("reflects an allowlisted request origin", () => {
    expect(
      resolveCorsOrigin(req("https://a.com"), {
        CORS_ALLOWED_ORIGIN: "https://a.com,https://b.com",
      }),
    ).toBe("https://a.com");
  });

  it("falls back to the first entry for a non-listed origin (locks it down)", () => {
    expect(
      resolveCorsOrigin(req("https://evil.com"), {
        CORS_ALLOWED_ORIGIN: "https://a.com,https://b.com",
      }),
    ).toBe("https://a.com");
  });

  it("uses the configured origin when the request has no Origin header", () => {
    expect(resolveCorsOrigin(req(), { CORS_ALLOWED_ORIGIN: "https://a.com" })).toBe(
      "https://a.com",
    );
  });
});
