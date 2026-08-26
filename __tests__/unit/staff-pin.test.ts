import { describe, expect, it } from "vitest";

import {
  hashStaffPin,
  isValidStaffPin,
  verifyStaffPin,
} from "../../src/lib/staff-pin";

describe("staff PIN credentials", () => {
  it("accepts only 6-8 numeric digits", () => {
    expect(isValidStaffPin("123456")).toBe(true);
    expect(isValidStaffPin("12345678")).toBe(true);
    expect(isValidStaffPin("1234")).toBe(false);
    expect(isValidStaffPin("12345a")).toBe(false);
  });

  it("uses unique salted scrypt hashes and verifies in constant-format flow", async () => {
    const first = await hashStaffPin("628194");
    const second = await hashStaffPin("628194");
    expect(first).toMatch(
      /^scrypt\$v1\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/,
    );
    expect(second).not.toBe(first);
    expect((await verifyStaffPin("628194", first)).valid).toBe(true);
    expect((await verifyStaffPin("628195", first)).valid).toBe(false);
  });

  it("rejects malformed and legacy plaintext values", async () => {
    expect((await verifyStaffPin("628194", "628194")).valid).toBe(false);
    expect((await verifyStaffPin("628194", "scrypt$v1$bad")).valid).toBe(false);
  });
});