import { describe, it, expect, vi, afterEach } from "vitest";

// A stub sql that reports an OVER-LIMIT count for the rate_limits upsert, so we
// can prove the gate 429s — and, with the escape hatch, that it never even runs.
const h = vi.hoisted(() => {
  const sql = ((_s: TemplateStringsArray, ..._v: unknown[]) =>
    Promise.resolve([{ count: 999 }])) as unknown as {
    (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown[]>;
  };
  return { sql };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql };
});

import { enforceRateLimit, enforceAccountRateLimit, isAccountRateLimited } from "../../src/lib/rate-limit";

function signupReq(): Request {
  return new Request("https://app.example.com/api/auth/signup", { method: "POST" });
}

afterEach(() => {
  delete process.env.DISABLE_RATE_LIMIT;
});

describe("enforceRateLimit — escape hatch for E2E", () => {
  it("429s a public endpoint that is over its per-IP limit", async () => {
    const res = await enforceRateLimit(signupReq(), {});
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("bypasses limiting when DISABLE_RATE_LIMIT is set on the env binding", async () => {
    const res = await enforceRateLimit(signupReq(), { DISABLE_RATE_LIMIT: "1" });
    expect(res).toBeNull();
  });

  it("bypasses limiting when DISABLE_RATE_LIMIT is set in process.env (Node dev)", async () => {
    process.env.DISABLE_RATE_LIMIT = "1";
    const res = await enforceRateLimit(signupReq(), {});
    expect(res).toBeNull();
  });

  it("treats DISABLE_RATE_LIMIT=0 / false as OFF (limits still apply)", async () => {
    const off = await enforceRateLimit(signupReq(), { DISABLE_RATE_LIMIT: "0" });
    expect(off!.status).toBe(429);
    const falsey = await enforceRateLimit(signupReq(), { DISABLE_RATE_LIMIT: "false" });
    expect(falsey!.status).toBe(429);
  });

  it("never limits an unmatched route", async () => {
    const res = await enforceRateLimit(
      new Request("https://app.example.com/api/health"),
      {},
    );
    expect(res).toBeNull();
  });
});

describe("per-account rate limiting", () => {
  it("flags an account that is over its per-tenant limit", async () => {
    expect(await isAccountRateLimited({}, "v_1", "copilot", 30, 60)).toBe(true);
  });

  it("429s via enforceAccountRateLimit", async () => {
    const res = await enforceAccountRateLimit({}, "v_1", "broadcast", 6, 60);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("bypasses when DISABLE_RATE_LIMIT is set (E2E escape hatch)", async () => {
    expect(await isAccountRateLimited({ DISABLE_RATE_LIMIT: "1" }, "v_1", "copilot", 30, 60)).toBe(
      false,
    );
    expect(await enforceAccountRateLimit({ DISABLE_RATE_LIMIT: "1" }, "v_1", "x", 1, 60)).toBeNull();
  });

  it("no-ops for a missing account id", async () => {
    expect(await isAccountRateLimited({}, "", "copilot", 30, 60)).toBe(false);
  });
});
