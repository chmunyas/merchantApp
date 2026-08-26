import { describe, expect, it } from "vitest";

import {
  generatePaymentIntentToken,
  hashPaymentIntentToken,
} from "../../src/lib/payment-intents";


describe("server payment intent credentials", () => {
  it("mints random 256-bit tokens and deterministic storage hashes", async () => {
    const first = generatePaymentIntentToken();
    const second = generatePaymentIntentToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(await hashPaymentIntentToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPaymentIntentToken(first)).toBe(
      await hashPaymentIntentToken(first),
    );
  });
});
