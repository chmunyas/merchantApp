import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const auth = {
    secret: "otp-production-test-secret",
    adminEmail: "admin@example.com",
    adminPasswordHash: "unused",
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/SELECT value FROM app_settings WHERE key = 'auth'/i.test(text)) {
      return Promise.resolve([{ value: auth }]);
    }
    if (/INSERT INTO rate_limits/i.test(text)) {
      return Promise.resolve([{ count: 1 }]);
    }
    return Promise.resolve([]);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    json: (value: unknown) => unknown;
  };
  sql.json = (value) => value;
  return { calls, sql };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

import { handleAuthRoute } from "../../src/api/auth";

describe("production OTP disclosure containment", () => {
  it("omits devCode from the actual response when debug is misconfigured on", async () => {
    h.calls.length = 0;
    const response = await handleAuthRoute(
      new Request("https://merchant.example.com/api/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: "email",
          destination: "owner@example.com",
        }),
      }),
      {
        APP_ENV: "production",
        AUTH_OTP_DEBUG: "1",
        JWT_SECRET: "otp-production-test-secret",
      },
    );

    expect(response?.status).toBe(503);
    const body = (await response?.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "Could not queue verification code." });
    expect(body).not.toHaveProperty("devCode");
    expect(h.calls.some((call) => /INSERT INTO auth_otps/i.test(call.text))).toBe(
      true,
    );
  });
});