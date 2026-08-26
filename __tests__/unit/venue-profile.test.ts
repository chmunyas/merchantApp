import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    vertical: "restaurant",
    tier: "starter",
    overrides: new Map<string, boolean>(),
    role: "merchant" as string,
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (/SELECT vertical, tier FROM venues/i.test(text)) {
      return Promise.resolve([{ vertical: state.vertical, tier: state.tier }]);
    }
    if (/SELECT capability, enabled FROM venue_capability_overrides/i.test(text)) {
      return Promise.resolve(
        [...state.overrides].map(([capability, enabled]) => ({ capability, enabled })),
      );
    }
    if (/UPDATE venues SET vertical/i.test(text)) {
      state.vertical = String(values[0]);
      return Promise.resolve([]);
    }
    if (/INSERT INTO venue_capability_overrides/i.test(text)) {
      state.overrides.set(String(values[1]), Boolean(values[2]));
      return Promise.resolve([]);
    }
    if (/DELETE FROM venue_capability_overrides/i.test(text)) {
      state.overrides.delete(String(values[1]));
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as unknown as never;
  return { state, sql };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

vi.mock("../../src/api/auth", () => ({
  requireAuth: () =>
    Promise.resolve({ sub: "owner@venue.test", role: h.state.role, venue: "v1" }),
}));

import { handleVenueProfileRoute } from "../../src/api/venue-profile";

const call = (method: string, body?: unknown) =>
  handleVenueProfileRoute(
    new Request("https://app.test/api/venue-profile", {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    {},
  );

beforeEach(() => {
  h.state.vertical = "restaurant";
  h.state.tier = "starter";
  h.state.overrides.clear();
  h.state.role = "merchant";
});

describe("GET /api/venue-profile", () => {
  it("resolves capabilities from the venue's vertical and tier", async () => {
    const res = await call("GET");
    const body = (await res!.json()) as {
      vertical: string;
      tier: string;
      capabilities: string[];
    };
    expect(body.vertical).toBe("restaurant");
    expect(body.capabilities).toContain("restaurant.kds");
    expect(body.capabilities).not.toContain("retail.counter");
    // starter plan: growth features withheld
    expect(body.capabilities).not.toContain("insights.copilot");
  });

  it("is readable by staff so the sidebar can render", async () => {
    h.state.role = "staff";
    const res = await call("GET");
    expect(res!.status).toBe(200);
  });

  it("reports what an upgrade would unlock", async () => {
    const res = await call("GET");
    const body = (await res!.json()) as { upgrades: Array<{ key: string }> };
    expect(body.upgrades.map((u) => u.key)).toContain("core.accounting");
  });
});

describe("PUT /api/venue-profile", () => {
  it("switches the venue's vertical and reshapes its capabilities", async () => {
    const res = await call("PUT", { vertical: "retail" });
    const body = (await res!.json()) as { vertical: string; capabilities: string[] };
    expect(body.vertical).toBe("retail");
    expect(body.capabilities).toContain("retail.counter");
    expect(body.capabilities).not.toContain("restaurant.kds");
  });

  it("lets an owner opt in to another vertical's capability within their plan", async () => {
    const res = await call("PUT", { overrides: { "retail.counter": true } });
    const body = (await res!.json()) as { capabilities: string[] };
    expect(body.capabilities).toContain("retail.counter");
  });

  it("refuses an override the plan does not cover, with 402", async () => {
    const res = await call("PUT", { overrides: { "insights.copilot": true } });
    expect(res!.status).toBe(402);
    expect(h.state.overrides.has("insights.copilot")).toBe(false);
  });

  it("rejects an unknown capability instead of storing it", async () => {
    const res = await call("PUT", { overrides: { "made.up": true } });
    expect(res!.status).toBe(400);
    expect(h.state.overrides.size).toBe(0);
  });

  it("rejects an unknown vertical", async () => {
    const res = await call("PUT", { vertical: "casino" });
    expect(res!.status).toBe(400);
    expect(h.state.vertical).toBe("restaurant");
  });

  it("clears an override when set to null", async () => {
    await call("PUT", { overrides: { "restaurant.kds": false } });
    expect(h.state.overrides.get("restaurant.kds")).toBe(false);
    await call("PUT", { overrides: { "restaurant.kds": null } });
    expect(h.state.overrides.has("restaurant.kds")).toBe(false);
  });

  it("is refused for a manager — venue productisation is owner-only", async () => {
    h.state.role = "manager";
    const res = await call("PUT", { vertical: "retail" });
    expect(res!.status).toBe(403);
    expect(h.state.vertical).toBe("restaurant");
  });

  it("never lets a merchant raise their own tier", async () => {
    await call("PUT", { tier: "enterprise" } as unknown);
    expect(h.state.tier).toBe("starter");
  });
});
