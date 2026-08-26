import { describe, expect, it } from "vitest";

import { canonicalKenyanPhone } from "../../src/lib/payment-status";

describe("canonical payment customer phone", () => {
  it("normalizes Kenyan local and country-code forms to one E.164 identity", () => {
    expect(canonicalKenyanPhone("0722 000 001")).toBe("+254722000001");
    expect(canonicalKenyanPhone("254722000001")).toBe("+254722000001");
    expect(canonicalKenyanPhone("+254722000001")).toBe("+254722000001");
  });

  it("preserves a non-Kenyan identity instead of relabelling it as Kenyan", () => {
    expect(canonicalKenyanPhone("+44 7700 900123")).toBe("+44 7700 900123");
    expect(canonicalKenyanPhone("  ")).toBeNull();
    expect(canonicalKenyanPhone(undefined)).toBeNull();
  });
});
