import { describe, expect, it } from "vitest";

import {
  allocateFixedTips,
  allocateWeightedTips,
  splitDirectJar,
} from "../../src/lib/tip-allocation";
import { effectiveDirectPct, type VenueTipSettings } from "../../src/lib/tip-distribution";
import {
  accountLast4,
  maskedAccount,
  normalizeAccountNumber,
  validatePayoutDetails,
} from "../../src/lib/payout-details";

const settings = (over: Partial<VenueTipSettings> = {}): VenueTipSettings => ({
  model: "split",
  defaultDirectPct: 60,
  jarMethod: "by_hours",
  timeZone: "Africa/Nairobi",
  ...over,
});

describe("splitDirectJar", () => {
  it("gives everything to the server under model 1", () => {
    expect(splitDirectJar(1234, 100)).toEqual({ direct: 1234, jar: 0 });
  });

  it("gives everything to the jar under model 2", () => {
    expect(splitDirectJar(1234, 0)).toEqual({ direct: 0, jar: 1234 });
  });

  it("never creates or loses a cent on an indivisible split", () => {
    for (let amount = 0; amount <= 400; amount += 1) {
      for (const pct of [0, 1, 33, 50, 60, 66, 99, 100]) {
        const split = splitDirectJar(amount, pct);
        expect(split.direct + split.jar).toBe(amount);
        expect(split.direct).toBeGreaterThanOrEqual(0);
        expect(split.jar).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("floors the direct share so the remainder always falls to the jar", () => {
    // 33% of 100 is 33.0; 33% of 101 is 33.33 → 33 direct, 68 jar.
    expect(splitDirectJar(101, 33)).toEqual({ direct: 33, jar: 68 });
    expect(splitDirectJar(1, 50)).toEqual({ direct: 0, jar: 1 });
    expect(splitDirectJar(1, 99)).toEqual({ direct: 0, jar: 1 });
  });

  it("rejects nonsense rather than guessing", () => {
    expect(() => splitDirectJar(-1, 50)).toThrow();
    expect(() => splitDirectJar(100, 101)).toThrow();
    expect(() => splitDirectJar(100, -1)).toThrow();
    expect(() => splitDirectJar(100, 33.5)).toThrow();
  });
});

describe("effectiveDirectPct", () => {
  it("ignores per-server overrides under the absolute models", () => {
    expect(effectiveDirectPct(settings({ model: "direct" }), 10)).toBe(100);
    expect(effectiveDirectPct(settings({ model: "jar" }), 90)).toBe(0);
  });

  it("uses the override, then the venue default, under the split model", () => {
    expect(effectiveDirectPct(settings(), 25)).toBe(25);
    expect(effectiveDirectPct(settings(), null)).toBe(60);
    expect(effectiveDirectPct(settings(), undefined)).toBe(60);
  });

  it("clamps a corrupted stored percentage into range", () => {
    expect(effectiveDirectPct(settings(), 140)).toBe(100);
    expect(effectiveDirectPct(settings(), -5)).toBe(0);
  });
});

describe("jar distribution by hours worked", () => {
  it("splits in proportion to seconds worked", () => {
    expect(
      allocateWeightedTips(9000, [
        { staffId: "a", weight: 4 * 3600 },
        { staffId: "b", weight: 2 * 3600 },
      ]),
    ).toEqual([
      { staffId: "a", amount: 6000 },
      { staffId: "b", amount: 3000 },
    ]);
  });

  it("distributes an indivisible remainder deterministically and completely", () => {
    const rows = allocateWeightedTips(100, [
      { staffId: "a", weight: 1 },
      { staffId: "b", weight: 1 },
      { staffId: "c", weight: 1 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(100);
    expect(rows.map((row) => row.amount)).toEqual([34, 33, 33]);
  });

  it("conserves the total for every amount across an awkward weighting", () => {
    for (let total = 0; total <= 250; total += 1) {
      const rows = allocateWeightedTips(total, [
        { staffId: "a", weight: 7 },
        { staffId: "b", weight: 11 },
        { staffId: "c", weight: 13 },
      ]);
      expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(total);
    }
  });

  it("refuses to pay a jar out when nobody worked", () => {
    expect(() => allocateWeightedTips(500, [{ staffId: "a", weight: 0 }])).toThrow();
  });
});

describe("jar distribution by fixed amount", () => {
  it("accepts a set of amounts that exactly exhausts the jar", () => {
    expect(
      allocateFixedTips(500, [
        { staffId: "b", amount: 200 },
        { staffId: "a", amount: 300 },
      ]),
    ).toEqual([
      { staffId: "a", amount: 300 },
      { staffId: "b", amount: 200 },
    ]);
  });

  it("refuses to invent or strand a cent", () => {
    expect(() => allocateFixedTips(500, [{ staffId: "a", amount: 499 }])).toThrow();
    expect(() => allocateFixedTips(500, [{ staffId: "a", amount: 501 }])).toThrow();
  });

  it("rejects a duplicated employee", () => {
    expect(() =>
      allocateFixedTips(500, [
        { staffId: "a", amount: 250 },
        { staffId: "a", amount: 250 },
      ]),
    ).toThrow();
  });
});

describe("payout details", () => {
  it("masks to the last four digits and never echoes the number", () => {
    expect(accountLast4("0722 123 456")).toBe("3456");
    expect(maskedAccount("3456")).toBe("•••• 3456");
    expect(normalizeAccountNumber("KE12-3456 7890")).toBe("KE1234567890");
  });

  it("validates an M-Pesa destination", () => {
    const details = validatePayoutDetails({
      method: "mpesa",
      accountName: "Amina Wanjiru",
      accountNumber: "0722 123 456",
    });
    expect(details.accountNumber).toBe("0722123456");
    expect(details.last4).toBe("3456");
    expect(details.bankName).toBeNull();
  });

  it("requires a bank name for a bank destination", () => {
    expect(() =>
      validatePayoutDetails({
        method: "bank",
        accountName: "Amina Wanjiru",
        accountNumber: "01100234567",
      }),
    ).toThrow(/bank's name/i);
  });

  it("rejects an account with fewer than four digits", () => {
    expect(() =>
      validatePayoutDetails({
        method: "bank",
        accountName: "Amina Wanjiru",
        bankName: "Equity",
        accountNumber: "ABCDEF",
      }),
    ).toThrow();
  });

  it("rejects an unknown method and an empty holder name", () => {
    expect(() =>
      validatePayoutDetails({
        method: "paypal" as never,
        accountName: "Amina",
        accountNumber: "0722123456",
      }),
    ).toThrow();
    expect(() =>
      validatePayoutDetails({
        method: "mpesa",
        accountName: "",
        accountNumber: "0722123456",
      }),
    ).toThrow();
  });
});
