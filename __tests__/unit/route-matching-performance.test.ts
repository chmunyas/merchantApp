import { describe, expect, it } from "vitest";
import {
  DYNAMIC_SEGMENTS,
  ROUTE_POLICIES,
  matchRoutePath,
  decideRoute,
} from "../../src/lib/route-policy";

// matchRoutePath used to execute every route regex on every request. It now
// tests only the bucket for the request's first segment, so the guarantee that
// matters is that it still returns EXACTLY what the exhaustive scan returned.
// The patterns come from the module itself — an earlier copy of this table
// drifted and produced a false failure.

function bruteForce(pathname: string) {
  const normalized = pathname.startsWith("/api/v1/")
    ? `/api/${pathname.slice("/api/v1/".length)}`
    : pathname;
  const out: string[] = [];
  for (const policy of ROUTE_POLICIES) {
    const segments = policy.path.split("/").map((segment) => {
      if (!segment.startsWith(":")) {
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      const name = segment.slice(1);
      return `(${DYNAMIC_SEGMENTS[name] ?? "[^/]+"})`;
    });
    if (new RegExp(`^${segments.join("/")}$`).test(normalized)) {
      out.push(policy.id);
    }
  }
  return out;
}

describe("bucketed route matching is behaviour-preserving", () => {
  it("returns the same policies, in the same order, for every declared path", () => {
    for (const policy of ROUTE_POLICIES) {
      const sample = policy.path
        .replace(/:uuid/g, "123e4567-e89b-12d3-a456-426614174000")
        .replace(/:hex/g, "abcdef012345")
        .replace(/:token/g, "abc123")
        .replace(/:channel/g, "telegram")
        .replace(/:ingress/g, "webhook")
        .replace(/:action/g, "paid")
        .replace(/:[A-Za-z]+/g, "sample");
      const fast = matchRoutePath(sample).map((m) => m.policy.id);
      expect(fast, `path ${policy.path}`).toEqual(bruteForce(sample));
    }
  });

  it("still resolves the /api/v1 alias", () => {
    expect(matchRoutePath("/api/v1/invoices").length).toBeGreaterThan(0);
  });

  it("still matches discovery paths outside /api", () => {
    const discovery = ROUTE_POLICIES.filter((p) =>
      p.path.startsWith("/.well-known/"),
    );
    for (const policy of discovery) {
      expect(matchRoutePath(policy.path).map((m) => m.policy.id)).toContain(
        policy.id,
      );
    }
  });

  it("returns nothing for an unknown API path", () => {
    expect(matchRoutePath("/api/definitely-not-a-route")).toHaveLength(0);
    expect(decideRoute("GET", "/api/definitely-not-a-route").kind).toBe("not-found");
  });

  it("still reports method-not-allowed rather than not-found", () => {
    const decision = decideRoute("TRACE", "/api/invoices");
    expect(decision.kind).toBe("method-not-allowed");
  });

  it("tests far fewer regexes than the exhaustive scan", () => {
    // Guards the optimisation itself: if bucketing silently degenerated to a
    // full scan the tests above would still pass.
    let executions = 0;
    const originalExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function patched(this: RegExp, s: string) {
      executions += 1;
      return originalExec.call(this, s);
    };
    try {
      matchRoutePath("/api/invoices");
    } finally {
      RegExp.prototype.exec = originalExec;
    }
    expect(executions).toBeLessThan(ROUTE_POLICIES.length / 4);
  });
});
