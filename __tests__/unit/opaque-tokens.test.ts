import { describe, expect, it } from "vitest";

import {
  generatePortalToken,
  hashPortalToken,
  portalOtpPurpose,
} from "../../src/lib/portal-token";
import {
  generateDeviceToken,
  hashDeviceToken,
} from "../../src/lib/device-token";

describe("opaque customer/device credentials", () => {
  it("mints 256-bit portal bearers and stores deterministic hashes", async () => {
    const token = generatePortalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPortalToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPortalToken(token)).toBe(await hashPortalToken(token));
  });

  it("binds OTP purpose to the exact venue and phone", async () => {
    const a = await portalOtpPurpose("v_1", "+254700000001");
    expect(a).toMatch(/^portal:[0-9a-f]{64}$/);
    expect(a).not.toBe(await portalOtpPurpose("v_2", "+254700000001"));
    expect(a).not.toBe(await portalOtpPurpose("v_1", "+254700000002"));
  });

  it("mints hash-only push device credentials", async () => {
    const token = generateDeviceToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashDeviceToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});