import { describe, it, expect } from "vitest";

import {
  base32Encode,
  generateTotpSecret,
  totpUri,
  verifyTotp,
} from "../../src/lib/totp";

// RFC 6238 SHA-1 test vector: ASCII secret "12345678901234567890" → base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("verifyTotp (RFC 6238)", () => {
  it("accepts the known code for its time-step (T=59s → 287082)", async () => {
    expect(await verifyTotp(RFC_SECRET, "287082", 59_000)).toBe(true);
  });

  it("rejects the code outside its ±1 window", async () => {
    expect(await verifyTotp(RFC_SECRET, "287082", 120_000)).toBe(false);
  });

  it("rejects a wrong code", async () => {
    expect(await verifyTotp(RFC_SECRET, "000000", 59_000)).toBe(false);
  });

  it("rejects malformed input", async () => {
    expect(await verifyTotp(RFC_SECRET, "12ab56", 59_000)).toBe(false);
    expect(await verifyTotp("not-base32!", "287082", 59_000)).toBe(false);
  });
});

describe("secret + uri", () => {
  it("generates a 20-byte (32-char) base32 secret", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("base32 round-trips through a known value", () => {
    expect(base32Encode(new TextEncoder().encode("12345678901234567890"))).toBe(
      RFC_SECRET,
    );
  });

  it("builds a scannable otpauth URI", () => {
    const uri = totpUri("ABCDEF", "owner@venue.test");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("secret=ABCDEF");
    expect(uri).toContain("issuer=PesaSwap");
  });
});
