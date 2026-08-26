import { describe, expect, it } from "vitest";

import { normalizeDestination } from "../../src/lib/otp";
import {
  maskPhone,
  payoutChallengeMessage,
  payoutOtpPurpose,
  PAYOUT_OTP_MAX_ATTEMPTS,
  PAYOUT_OTP_RATE_LIMIT,
  resolveChallengeTarget,
} from "../../src/lib/payout-challenge";

describe("payout step-up — the code goes where the attacker cannot reach", () => {
  it("resolves the destination from the stored staff phone, normalised to E.164", () => {
    const target = resolveChallengeTarget("0712345678", normalizeDestination);
    expect(target).toEqual({ ok: true, phone: "+254712345678" });
  });

  it("accepts an already-normalised international number unchanged", () => {
    const target = resolveChallengeTarget("+254712345678", normalizeDestination);
    expect(target).toEqual({ ok: true, phone: "+254712345678" });
  });

  it("refuses when the staff record has no phone, rather than falling back", () => {
    // The fallback an attacker wants is "use the number in the request body".
    // There must not be one.
    for (const empty of [null, undefined, "", "   "]) {
      expect(resolveChallengeTarget(empty, normalizeDestination)).toEqual({
        ok: false,
        reason: "no-phone",
      });
    }
  });

  it("refuses a phone that cannot be dialled instead of sending into the void", () => {
    for (const junk of ["not-a-phone", "12", "+0123456789", "abc123"]) {
      const target = resolveChallengeTarget(junk, normalizeDestination);
      expect(target.ok, `expected ${junk} to be rejected`).toBe(false);
    }
  });
});

describe("payout step-up — code binding", () => {
  it("binds a code to one staff member so it cannot be replayed for another", () => {
    const a = payoutOtpPurpose("11111111-1111-4111-8111-111111111111");
    const b = payoutOtpPurpose("22222222-2222-4222-8222-222222222222");
    expect(a).not.toEqual(b);
  });

  it("uses a purpose distinct from login, so a login code cannot move bank details", () => {
    expect(payoutOtpPurpose("11111111-1111-4111-8111-111111111111")).not.toBe("login");
    expect(payoutOtpPurpose("11111111-1111-4111-8111-111111111111")).toMatch(/^payout:/);
  });
});

describe("payout step-up — what the staff member sees", () => {
  it("masks all but the last four digits of the destination", () => {
    const masked = maskPhone("+254712345678");
    expect(masked.endsWith("5678")).toBe(true);
    expect(masked).not.toContain("254712");
  });

  it("never leaks a short value in full", () => {
    expect(maskPhone("+1")).toBe("•••");
  });

  it("tells the staff member what to do if they did not request it", () => {
    const message = payoutChallengeMessage("123456", "5678");
    expect(message).toContain("123456");
    // The code alone is useless to a victim who does not know it signals an
    // attack in progress.
    expect(message.toLowerCase()).toContain("did not request");
    expect(message.toLowerCase()).toContain("manager");
    expect(message.toLowerCase()).toContain("never share");
  });
});

describe("payout step-up — brute-force budget", () => {
  it("caps attempts and code requests low enough to be useless to a guesser", () => {
    // 6 digits, 5 attempts per code, 3 codes/hour => 15 guesses/hour against
    // 1e6 possibilities.
    const guessesPerHour = PAYOUT_OTP_MAX_ATTEMPTS * PAYOUT_OTP_RATE_LIMIT;
    expect(guessesPerHour).toBeLessThanOrEqual(20);
    expect(guessesPerHour / 1_000_000).toBeLessThan(0.0001);
  });
});
