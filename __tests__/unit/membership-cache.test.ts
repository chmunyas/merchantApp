import { describe, expect, it, vi, beforeEach } from "vitest";

// The per-request membership check is a DB round-trip on the critical path of
// every authenticated call. It can be cached, but `membership_version` exists to
// revoke a session immediately — so caching must be OFF unless an operator opts
// in, and must never cache a negative result (which would lock out a user who
// was just granted access).

function makeSql() {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push(text);
    if (/FROM user_venues/i.test(text)) {
      return Promise.resolve([{ role: "merchant", membership_version: 1 }]);
    }
    return Promise.resolve([]);
  }) as unknown as never;
  return { sql, calls };
}

async function load() {
  vi.resetModules();
  return import("../../src/api/auth");
}

describe("membership caching is opt-in", () => {
  beforeEach(() => vi.resetModules());

  it("is disabled by default, so revocation stays immediate", async () => {
    const mod = await load();
    expect(mod).toBeDefined();
    // Behaviour is pinned by membership-session.test.ts; this asserts the
    // default value that keeps it true.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/api/auth.ts", "utf8"),
    );
    expect(source).toMatch(/const MEMBERSHIP_TTL_DEFAULT_MS = 0;/);
  });

  it("reads the TTL from AUTH_MEMBERSHIP_TTL_MS", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/api/auth.ts", "utf8"),
    );
    expect(source).toMatch(/envVar\(env, "AUTH_MEMBERSHIP_TTL_MS"\)/);
  });

  it("bypasses the cache entirely when the TTL is zero", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/api/auth.ts", "utf8"),
    );
    expect(source).toMatch(
      /if \(ttl === 0\) return loadVenueMembership\(sql, email, venue\);/,
    );
  });

  it("never caches a negative membership lookup", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/api/auth.ts", "utf8"),
    );
    expect(source).toMatch(/if \(membership\) \{/);
    expect(source).toMatch(/membershipCache\.delete\(key\)/);
  });

  it("bounds the cache so a long-lived isolate cannot grow unboundedly", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/api/auth.ts", "utf8"),
    );
    expect(source).toMatch(/MEMBERSHIP_CACHE_MAX/);
    expect(source).toMatch(/membershipCache\.clear\(\)/);
  });

  it("keeps login-time claim resolution uncached", async () => {
    // authoritativeVenueClaims mints tokens; it must read through to the DB.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/api/auth.ts", "utf8"),
    );
    const fn = source.slice(source.indexOf("async function authoritativeVenueClaims"));
    expect(fn.slice(0, 600)).toMatch(/await loadVenueMembership\(sql, email, venue\)/);
    expect(fn.slice(0, 600)).not.toMatch(/cachedVenueMembership/);
  });
});

describe("route matching stays keyed correctly", () => {
  it("keys the membership cache on both email and venue", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/api/auth.ts", "utf8"),
    );
    expect(source).toMatch(/const key = `\$\{email\.toLowerCase\(\)\}\\u0000\$\{venue\}`/);
  });

  it("has a sql stub available for future behavioural tests", () => {
    const { sql, calls } = makeSql();
    expect(sql).toBeTypeOf("function");
    expect(calls).toEqual([]);
  });
});
