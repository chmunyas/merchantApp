import { describe, expect, it } from "vitest";

import { handleAuthRoute } from "../../src/api/auth";
import { handleChannelRoute } from "../../src/api/channels";
import { handlePaymentRoute } from "../../src/api/payments";
import { handleWhatsappRoute } from "../../src/api/whatsapp";
import { signJwt } from "../../src/lib/jwt";
import {
  otpDebugAllowed,
  runtimeMode,
  runtimeSecurityResponse,
  simulatorsAllowed,
  validateRuntimeSecurity,
} from "../../src/lib/runtime-security";

const secureProduction = {
  APP_ENV: "production",
  AUTH_REQUIRE_LOGIN: "1",
  AUTH_OTP_DEBUG: "0",
  PAYMENTS_TEST_MODE: "0",
  ALLOW_SIMULATORS: "0",
  JWT_SECRET: "test-jwt-secret-that-is-not-used-outside-tests",
  PESASWAP_API_KEY: "test-api-key",
  PESASWAP_WEBHOOK_SECRET: "test-webhook-secret",
  TURNSTILE_SECRET: "test-turnstile-secret",
  CORS_ALLOWED_ORIGIN: "https://merchant.example.com",
};

describe("production runtime containment", () => {
  it("treats unknown deployed profiles as production", () => {
    expect(runtimeMode({ HYPERDRIVE: {} })).toBe("production");
    expect(runtimeMode({ APP_ENV: "sandbox", HYPERDRIVE: {} })).toBe("sandbox");
  });

  it("rejects insecure production flags and missing critical secrets", async () => {
    const env = {
      APP_ENV: "production",
      AUTH_REQUIRE_LOGIN: "0",
      AUTH_OTP_DEBUG: "1",
      PAYMENTS_TEST_MODE: "1",
      ALLOW_SIMULATORS: "1",
      CORS_ALLOWED_ORIGIN: "*",
    };
    const result = validateRuntimeSecurity(env);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("AUTH_REQUIRE_LOGIN"),
        expect.stringContaining("AUTH_OTP_DEBUG"),
        expect.stringContaining("PAYMENTS_TEST_MODE"),
        expect.stringContaining("ALLOW_SIMULATORS"),
        expect.stringContaining("JWT_SECRET"),
        expect.stringContaining("PESASWAP_API_KEY"),
        expect.stringContaining("PESASWAP_WEBHOOK_SECRET"),
        expect.stringContaining("TURNSTILE_SECRET"),
        expect.stringContaining("CORS_ALLOWED_ORIGIN"),
      ]),
    );
    const response = runtimeSecurityResponse(env);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: "service unavailable: insecure production configuration",
    });
  });

  it("accepts the secure production profile", () => {
    expect(validateRuntimeSecurity(secureProduction).errors).toEqual([]);
    expect(runtimeSecurityResponse(secureProduction)).toBeNull();
  });

  it("never enables OTP echo or simulators in production", () => {
    expect(
      otpDebugAllowed({ APP_ENV: "production", AUTH_OTP_DEBUG: "1" }),
    ).toBe(false);
    expect(
      simulatorsAllowed({ APP_ENV: "production", ALLOW_SIMULATORS: "1" }),
    ).toBe(false);
    expect(
      otpDebugAllowed({ APP_ENV: "development", AUTH_OTP_DEBUG: "1" }),
    ).toBe(true);
    expect(
      simulatorsAllowed({ APP_ENV: "sandbox", ALLOW_SIMULATORS: "1" }),
    ).toBe(true);
  });

  it("blocks anonymous operator-session bootstrap", async () => {
    const response = await handleAuthRoute(
      new Request("https://merchant.example.com/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "merchant" }),
      }),
      secureProduction,
    );
    expect(response?.status).toBe(403);
  });

  it("blocks unauthenticated and sub-manager refunds before provider access", async () => {
    const request = (authorization?: string) =>
      new Request("https://merchant.example.com/api/refunds", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({ payment_id: "pay_test", reason: "other" }),
      });

    const anonymous = await handlePaymentRoute(request(), secureProduction);
    expect(anonymous?.status).toBe(401);

    const staffToken = await signJwt(
      { sub: "staff:test", role: "supervisor", venue: "main" },
      secureProduction.JWT_SECRET,
    );
    const staff = await handlePaymentRoute(
      request(`Bearer ${staffToken}`),
      secureProduction,
    );
    // A pre-migration venue token has no membership version, so it is rejected
    // as an invalid session before the refund role gate runs.
    expect(staff?.status).toBe(401);
  });

  it("hides production simulators and protects bridge ingress/control", async () => {
    const simulator = await handleChannelRoute(
      new Request("https://merchant.example.com/api/channels/simulate", {
        method: "POST",
      }),
      secureProduction,
    );
    expect(simulator?.status).toBe(404);

    const whatsappSimulator = await handleWhatsappRoute(
      new Request("https://merchant.example.com/api/whatsapp/simulate", {
        method: "POST",
      }),
      secureProduction,
    );
    expect(whatsappSimulator?.status).toBe(404);

    const bridgeInbound = await handleWhatsappRoute(
      new Request("https://merchant.example.com/api/whatsapp/bridge/inbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "+254700000000", text: "hello" }),
      }),
      secureProduction,
    );
    expect(bridgeInbound?.status).toBe(503);

    const bridgeControl = await handleWhatsappRoute(
      new Request("https://merchant.example.com/api/whatsapp/bridge/status"),
      secureProduction,
    );
    expect(bridgeControl?.status).toBe(401);
  });
});
