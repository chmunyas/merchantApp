import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  type MockSql = {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    json: (value: unknown) => unknown;
    begin: <T>(callback: (transaction: MockSql) => Promise<T>) => Promise<T>;
  };
  const state = { callerRole: "merchant" };
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (/SELECT uv\.role FROM user_venues/i.test(text)) {
      return Promise.resolve([{ role: state.callerRole }]);
    }
    if (/SELECT id FROM app_users/i.test(text)) {
      return Promise.resolve([{ id: "00000000-0000-4000-8000-000000000002" }]);
    }
    if (/SELECT count\(\*\)::int AS n FROM user_venues/i.test(text)) {
      return Promise.resolve([{ n: 1 }]);
    }
    if (/SELECT role, membership_version\s+FROM user_venues/i.test(text)) {
      return Promise.resolve([{ role: "staff", membership_version: 2 }]);
    }
    if (/INSERT INTO user_venues/i.test(text)) {
      return Promise.resolve([{ role: "manager", membership_version: 3 }]);
    }
    return Promise.resolve([]);
  }) as unknown as MockSql;
  sql.json = (value) => value;
  sql.begin = (callback) => callback(sql);
  return { calls, sql, state };
});

vi.mock("../../src/api/auth", () => ({
  requireHumanAuth: vi.fn(async () => ({
    kind: "human-jwt",
    sub: "owner@example.com",
    role: "merchant",
    venue: "v_1",
    plan: "pro",
  })),
}));
vi.mock("../../src/lib/db", () => ({ getSql: () => harness.sql }));

import { handleMultiStoreRoute } from "../../src/api/multistore";

function grantManagerRequest() {
  return new Request("https://merchant.test/api/venues/members?venue=v_1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "manager@example.com",
      name: "Venue Manager",
      role: "manager",
    }),
  });
}

describe("versioned membership management", () => {
  beforeEach(() => {
    harness.calls.length = 0;
    harness.state.callerRole = "merchant";
  });

  it("prevents a manager from granting a manager role", async () => {
    harness.state.callerRole = "manager";

    const response = await handleMultiStoreRoute(grantManagerRequest(), {});

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      error: "You cannot grant that role.",
    });
    expect(
      harness.calls.some((call) => /INSERT INTO user_venues/i.test(call.text)),
    ).toBe(false);
  });

  it("returns the new version and appends an immutable role-change fact", async () => {
    const response = await handleMultiStoreRoute(grantManagerRequest(), {});

    expect(response?.status).toBe(201);
    expect(await response?.json()).toMatchObject({
      member: {
        email: "manager@example.com",
        role: "manager",
        membershipVersion: 3,
      },
    });
    const event = harness.calls.find((call) =>
      /INSERT INTO venue_membership_events/i.test(call.text),
    );
    expect(event).toBeDefined();
    expect(event?.values).toEqual(
      expect.arrayContaining([
        "v_1",
        "manager@example.com",
        "owner@example.com",
        "merchant",
        "role_changed",
        "staff",
        "manager",
        2,
        3,
      ]),
    );
  });
});
