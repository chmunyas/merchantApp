import { describe, expect, it } from "vitest";

import { isValidStaffPin, isWeakStaffPin } from "../../src/lib/staff-pin";

describe("staff PIN — weak PINs are refused when one is SET", () => {
  it("rejects a PIN made of one repeated digit", () => {
    for (const pin of ["000000", "111111", "9999999", "88888888"]) {
      expect(isWeakStaffPin(pin), pin).toBe(true);
    }
  });

  it("rejects ascending and descending runs, including ones that wrap", () => {
    for (const pin of ["123456", "234567", "654321", "890123", "987654"]) {
      expect(isWeakStaffPin(pin), pin).toBe(true);
    }
  });

  it("rejects a short repeating block", () => {
    // "123123" is no harder to guess than "123456".
    for (const pin of ["121212", "123123", "12341234", "454545"]) {
      expect(isWeakStaffPin(pin), pin).toBe(true);
    }
  });

  it("accepts an ordinary PIN", () => {
    for (const pin of ["481937", "205846", "7391024", "60418293"]) {
      expect(isWeakStaffPin(pin), pin).toBe(false);
    }
  });
});

describe("staff PIN — the weak check must not reach the LOGIN path", () => {
  // isValidStaffPin guards login as well as set. If the weak rule had been
  // folded into it, every existing staff member holding a weak PIN would have
  // been locked out by this change instead of being asked to rotate it.
  it("still treats a weak PIN as structurally valid", () => {
    for (const pin of ["000000", "123456", "121212"]) {
      expect(isValidStaffPin(pin), pin).toBe(true);
    }
  });

  it("reports non-PINs as neither valid nor weak", () => {
    for (const pin of ["", "12345", "123456789", "abcdef", "12 3456"]) {
      expect(isValidStaffPin(pin), pin).toBe(false);
      // A malformed value is rejected by the format check; calling it "weak"
      // would produce a misleading error message.
      expect(isWeakStaffPin(pin), pin).toBe(false);
    }
  });
});
