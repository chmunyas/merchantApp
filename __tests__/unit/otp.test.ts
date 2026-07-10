import { describe, it, expect } from "vitest";

import {
  generateOtpCode,
  hashOtp,
  normalizeDestination,
  timingSafeEqualHex,
} from "../../src/lib/otp";

describe("OTP codes", () => {
  it("generates a 6-digit code", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("hashes deterministically, peppered by the secret", async () => {
    const a = await hashOtp("123456", "user@x.com", "pepper1");
    const b = await hashOtp("123456", "user@x.com", "pepper1");
    const c = await hashOtp("123456", "user@x.com", "pepper2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("compares hex constant-time-safely", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abc")).toBe(false);
  });
});

describe("normalizeDestination", () => {
  it("lowercases email", () => {
    expect(normalizeDestination("email", "Owner@Venue.TEST")).toBe("owner@venue.test");
  });

  it("normalizes Kenyan phone numbers to E.164", () => {
    expect(normalizeDestination("whatsapp", "0722123456")).toBe("+254722123456");
    expect(normalizeDestination("sms", "254722123456")).toBe("+254722123456");
    expect(normalizeDestination("whatsapp", "+254722123456")).toBe("+254722123456");
    expect(normalizeDestination("sms", "722123456")).toBe("+254722123456");
  });

  it("returns empty for blank input", () => {
    expect(normalizeDestination("email", "")).toBe("");
    expect(normalizeDestination("sms", "")).toBe("");
  });
});
