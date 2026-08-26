import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const state: {
    role: string;
    membershipVersion: number;
    present: boolean;
    venue: string;
  } = {
    role: "manager",
    membershipVersion: 4,
    present: true,
    venue: "v_1",
  };
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/FROM user_venues uv/i.test(text)) {
      const requestedVenue = String(values[1] ?? "");
      if (!state.present || requestedVenue !== state.venue) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        {
          role: state.role,
          membership_version: state.membershipVersion,
        },
      ]);
    }
    return Promise.resolve([]);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    json: (value: unknown) => unknown;
  };
  sql.json = (value) => value;
  return { calls, sql, state };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => harness.sql };
});

import { requireAuth } from "../../src/api/auth";
import { signJwt } from "../../src/lib/jwt";

const SECRET = "membership-session-test-secret";

async function requestWithClaims(claims: Record<string, unknown>) {
  const token = await signJwt(claims, SECRET);
  return new Request("https://merchant.test/api/payments", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("authoritative venue membership sessions", () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.state.role = "manager";
    harness.state.membershipVersion = 4;
    harness.state.present = true;
    harness.state.venue = "v_1";
  });

  it("accepts a token only while role and membership version match", async () => {
    const payload = await requireAuth(
      await requestWithClaims({
        sub: "manager@example.com",
        role: "manager",
        venue: "v_1",
        membership_version: 4,
      }),
      { JWT_SECRET: SECRET },
    );

    expect(payload).toMatchObject({
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
      membership_version: 4,
      kind: "human-jwt",
    });
  });

  it("validates an email staff member against venue membership, not PIN credentials", async () => {
    harness.state.role = "staff";
    const payload = await requireAuth(
      await requestWithClaims({
        sub: "staff@example.com",
        role: "staff",
        venue: "v_1",
        membership_version: 4,
      }),
      { JWT_SECRET: SECRET },
    );

    expect(payload).toMatchObject({
      sub: "staff@example.com",
      role: "staff",
      venue: "v_1",
      membership_version: 4,
    });
  });

  it("revokes an existing token immediately after a role change", async () => {
    harness.state.role = "staff";

    expect(
      await requireAuth(
        await requestWithClaims({
          sub: "manager@example.com",
          role: "manager",
          venue: "v_1",
          membership_version: 4,
        }),
        { JWT_SECRET: SECRET },
      ),
    ).toBeNull();
  });

  it("revokes an existing token when the membership version advances", async () => {
    harness.state.membershipVersion = 5;

    expect(
      await requireAuth(
        await requestWithClaims({
          sub: "manager@example.com",
          role: "manager",
          venue: "v_1",
          membership_version: 4,
        }),
        { JWT_SECRET: SECRET },
      ),
    ).toBeNull();
  });

  it("revokes deleted memberships and rejects cross-venue reuse", async () => {
    harness.state.present = false;
    const deleted = await requireAuth(
      await requestWithClaims({
        sub: "manager@example.com",
        role: "manager",
        venue: "v_1",
        membership_version: 4,
      }),
      { JWT_SECRET: SECRET },
    );
    harness.state.present = true;
    const crossVenue = await requireAuth(
      await requestWithClaims({
        sub: "manager@example.com",
        role: "manager",
        venue: "v_2",
        membership_version: 4,
      }),
      { JWT_SECRET: SECRET },
    );

    expect(deleted).toBeNull();
    expect(crossVenue).toBeNull();
  });

  it("invalidates pre-migration venue tokens without a membership version", async () => {
    expect(
      await requireAuth(
        await requestWithClaims({
          sub: "manager@example.com",
          role: "manager",
          venue: "v_1",
        }),
        { JWT_SECRET: SECRET },
      ),
    ).toBeNull();
  });
});
