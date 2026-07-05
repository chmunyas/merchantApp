import { describe, it, expect } from "vitest";

import {
  hashPassword,
  signJwt,
  verifyJwt,
  verifyPassword,
} from "../../src/lib/jwt";

const SECRET = "test-secret-key-please-rotate";

describe("jwt", () => {
  it("signs and verifies a valid token", async () => {
    const token = await signJwt({ sub: "user@x.com", role: "admin" }, SECRET);
    const payload = await verifyJwt(token, SECRET);
    expect(payload?.sub).toBe("user@x.com");
    expect(payload?.role).toBe("admin");
    expect(payload?.exp).toBeGreaterThan(payload?.iat as number);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signJwt({ sub: "a" }, SECRET);
    expect(await verifyJwt(token, "wrong-secret")).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signJwt({ sub: "a", role: "customer" }, SECRET);
    const [h, , s] = token.split(".");
    const forged = `${h}.${btoa(JSON.stringify({ sub: "a", role: "admin" }))}.${s}`;
    expect(await verifyJwt(forged, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signJwt({ sub: "a" }, SECRET, -10);
    expect(await verifyJwt(token, SECRET)).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyJwt("not-a-jwt", SECRET)).toBeNull();
    expect(await verifyJwt("a.b", SECRET)).toBeNull();
  });
});

describe("password hashing", () => {
  it("hashes with a salt (different each time) and verifies", async () => {
    const h1 = await hashPassword("s3cret!");
    const h2 = await hashPassword("s3cret!");
    expect(h1).not.toBe(h2); // random salt
    expect(h1.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("s3cret!", h1)).toBe(true);
    expect(await verifyPassword("wrong", h1)).toBe(false);
  });
});
