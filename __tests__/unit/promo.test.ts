import { describe, it, expect } from "vitest";

import {
  applyPromo,
  normalizeCode,
  type PromoCode,
} from "../../src/lib/promo";

const base: Omit<PromoCode, "kind" | "value"> = {
  code: "SAVE",
  minOrder: 0,
  maxDiscount: 0,
  active: true,
  startsAt: null,
  expiresAt: null,
  usageLimit: 0,
  usedCount: 0,
};

describe("applyPromo", () => {
  it("applies a percentage discount", () => {
    const r = applyPromo({ ...base, kind: "percent", value: 10 }, 1000);
    expect(r).toEqual({ valid: true, discount: 100, finalTotal: 900 });
  });

  it("applies a fixed discount and never exceeds the bill", () => {
    expect(applyPromo({ ...base, kind: "fixed", value: 200 }, 1000).discount).toBe(
      200,
    );
    const capped = applyPromo({ ...base, kind: "fixed", value: 5000 }, 1000);
    expect(capped.discount).toBe(1000);
    expect(capped.finalTotal).toBe(0);
  });

  it("caps a percentage discount at max_discount", () => {
    const r = applyPromo(
      { ...base, kind: "percent", value: 50, maxDiscount: 300 },
      1000,
    );
    expect(r.discount).toBe(300);
    expect(r.finalTotal).toBe(700);
  });

  it("rejects below the minimum order", () => {
    const r = applyPromo(
      { ...base, kind: "percent", value: 10, minOrder: 2000 },
      1000,
    );
    expect(r.valid).toBe(false);
    expect(r.discount).toBe(0);
    expect(r.reason).toMatch(/minimum/i);
  });

  it("rejects inactive, expired, exhausted and unknown codes", () => {
    expect(applyPromo(null, 1000).reason).toMatch(/not found/i);
    expect(
      applyPromo({ ...base, kind: "fixed", value: 100, active: false }, 1000)
        .valid,
    ).toBe(false);
    expect(
      applyPromo(
        {
          ...base,
          kind: "fixed",
          value: 100,
          expiresAt: "2020-01-01T00:00:00Z",
        },
        1000,
      ).reason,
    ).toMatch(/expired/i);
    expect(
      applyPromo(
        { ...base, kind: "fixed", value: 100, usageLimit: 5, usedCount: 5 },
        1000,
      ).reason,
    ).toMatch(/redeemed/i);
  });
});

describe("normalizeCode", () => {
  it("upper-cases, trims and strips spaces", () => {
    expect(normalizeCode(" save 10 ")).toBe("SAVE10");
    expect(normalizeCode("welcome")).toBe("WELCOME");
  });
});
