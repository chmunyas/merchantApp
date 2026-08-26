import { beforeAll, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const state = { passwordHash: "" };
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (/SELECT value FROM app_settings WHERE key = 'auth'/i.test(text)) {
      return Promise.resolve([
        {
          value: {
            secret: "membership-login-secret",
            adminEmail: "admin@example.com",
            adminPasswordHash: "unused",
          },
        },
      ]);
    }
    if (/FROM app_users WHERE lower\(email\)/i.test(text)) {
      return Promise.resolve([
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "manager@example.com",
          password_hash: state.passwordHash,
          name: "Venue Manager",
          venue_id: "v_1",
          role: "merchant",
          plan: "growth",
          org_id: null,
          totp_secret: null,
          totp_enabled: false,
        },
      ]);
    }
    if (/FROM user_venues uv/i.test(text)) {
      return Promise.resolve([{ role: "manager", membership_version: 7 }]);
    }
    return Promise.resolve([]);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    json: (value: unknown) => unknown;
  };
  sql.json = (value) => value;
  return { sql, state };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => harness.sql };
});

import { handleAuthRoute } from "../../src/api/auth";
import { hashPassword, verifyJwt } from "../../src/lib/jwt";

const SECRET = "membership-login-secret";

describe("membership-derived password login", () => {
  beforeAll(async () => {
    harness.state.passwordHash = await hashPassword("correct-password");
  });

  it("mints the current venue membership role and version", async () => {
    const response = await handleAuthRoute(
      new Request("https://merchant.test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "manager@example.com",
          password: "correct-password",
        }),
      }),
      { JWT_SECRET: SECRET },
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      token: string;
      user: { role: string; venue: string };
    };
    expect(body.user).toMatchObject({ role: "manager", venue: "v_1" });
    expect(await verifyJwt(body.token, SECRET)).toMatchObject({
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
      membership_version: 7,
    });
  });
});
