import { describe, it, expect } from "vitest";

import { resolveCorsOrigin } from "../../src/lib/cors";

function req(origin?: string): Request {
  const h = new Headers();
  if (origin) h.set("origin", origin);
  return new Request("https://app.example.com/api/x", { headers: h });
}

describe("resolveCorsOrigin", () => {
  it("returns null when CORS_ALLOWED_ORIGIN is unset", () => {
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

  it("denies a non-listed origin", () => {
    expect(
      resolveCorsOrigin(req("https://evil.com"), {
        CORS_ALLOWED_ORIGIN: "https://a.com,https://b.com",
      }),
    ).toBeNull();
  });

  it("does not emit CORS for same-origin requests without Origin", () => {
    expect(resolveCorsOrigin(req(), { CORS_ALLOWED_ORIGIN: "https://a.com" })).toBeNull();
  });
});
