// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import { decodeTokenClaims, isDemoSession } from "../../src/lib/auth";

// Build an unsigned JWT (header.payload.sig) with the given claims — only the
// payload is read by the client helpers.
const b64url = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (claims: object) => `h.${b64url(claims)}.s`;

describe("decodeTokenClaims", () => {
  it("reads the payload claims", () => {
    expect(decodeTokenClaims(jwt({ venue: "v_1", role: "merchant" }))).toEqual({
      venue: "v_1",
      role: "merchant",
    });
  });

  it("returns null for a missing or malformed token", () => {
    expect(decodeTokenClaims(null)).toBeNull();
    expect(decodeTokenClaims("not-a-jwt")).toBeNull();
  });
});

describe("isDemoSession", () => {
  it("is TRUE for an anonymous session (no venue claim)", () => {
    expect(isDemoSession(jwt({ sub: "session:merchant", role: "merchant" }))).toBe(
      true,
    );
  });

  it("is FALSE for a real merchant/staff login (has a venue claim)", () => {
    expect(
      isDemoSession(jwt({ sub: "a@b.com", role: "merchant", venue: "v_73282ff8" })),
    ).toBe(false);
    expect(isDemoSession(jwt({ role: "staff", venue: "v_1" }))).toBe(false);
  });

  it("is FALSE for a platform admin (legitimately venue-less)", () => {
    expect(isDemoSession(jwt({ sub: "admin", role: "admin" }))).toBe(false);
  });

  it("is FALSE when there is no token at all", () => {
    expect(isDemoSession(null)).toBe(false);
  });
});
