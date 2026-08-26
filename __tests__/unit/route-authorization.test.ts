import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/auth", () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from "../../src/api/auth";
import { authorizeRouteRequest } from "../../src/lib/route-authorization";
import { ROUTE_POLICIES } from "../../src/lib/route-policy";

function policy(id: string) {
  const found = ROUTE_POLICIES.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing policy ${id}`);
  return found;
}

describe("central route authorization", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockReset();
  });

  it("denies anonymous callers on protected routes", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    const denied = await authorizeRouteRequest(
      new Request("https://merchant.test/api/memory"),
      {},
      policy("memory.read"),
      {},
      "req-1",
    );
    expect(denied?.status).toBe(401);
  });

  it("requires manager role and a venue claim for AI memory", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "staff@example.com",
      role: "staff",
      venue: "v_1",
    });
    const staff = await authorizeRouteRequest(
      new Request("https://merchant.test/api/memory"),
      {},
      policy("memory.read"),
      {},
      "req-2",
    );
    expect(staff?.status).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "manager@example.com",
      role: "manager",
    });
    const missingVenue = await authorizeRouteRequest(
      new Request("https://merchant.test/api/memory"),
      {},
      policy("memory.read"),
      {},
      "req-3",
    );
    expect(missingVenue?.status).toBe(403);
  });

  it("allows a manager human with a bound venue", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    });
    expect(
      await authorizeRouteRequest(
        new Request("https://merchant.test/api/memory"),
        {},
        policy("memory.read"),
        {},
        "req-4",
      ),
    ).toBeNull();
  });

  it("denies a manager from changing owner-only service settings", async () => {    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    });
    const denied = await authorizeRouteRequest(
      new Request("https://merchant.test/api/venue-service-settings", {
        method: "PUT",
      }),
      {},
      policy("venue-service-settings.write"),
      {},
      "req-service-settings-role",
    );
    expect(denied?.status).toBe(403);
  });

  it("gates the venue-wide menu pairings read on manager + menu:read", async () => {
    const request = () =>
      new Request("https://merchant.test/api/menu/upsells");

    vi.mocked(requireAuth).mockResolvedValue(null);
    expect(
      (
        await authorizeRouteRequest(
          request(),
          {},
          policy("menu.upsells.read"),
          {},
          "req-upsells-anon",
        )
      )?.status,
    ).toBe(401);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "staff@example.com",
      role: "staff",
      venue: "v_1",
    });
    expect(
      (
        await authorizeRouteRequest(
          request(),
          {},
          policy("menu.upsells.read"),
          {},
          "req-upsells-staff",
        )
      )?.status,
    ).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "api-token",
      isApiToken: true,
      sub: "token:9",
      tokenId: "9",
      role: "manager",
      venue: "v_1",
      scopes: ["menu:write"],
    });
    expect(
      (
        await authorizeRouteRequest(
          request(),
          {},
          policy("menu.upsells.read"),
          {},
          "req-upsells-wrong-scope",
        )
      )?.status,
    ).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    });
    expect(
      await authorizeRouteRequest(
        request(),
        {},
        policy("menu.upsells.read"),
        {},
        "req-upsells-ok",
      ),
    ).toBeNull();
  });

  it("requires exact PAT scopes and token role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      kind: "api-token",
      isApiToken: true,
      sub: "token:1",
      tokenId: "1",
      role: "manager",
      venue: "v_1",
      scopes: ["knowledge:write"],
    });
    const wrongScope = await authorizeRouteRequest(
      new Request("https://merchant.test/api/memory"),
      {},
      policy("memory.read"),
      {},
      "req-5",
    );
    expect(wrongScope?.status).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "api-token",
      isApiToken: true,
      sub: "token:2",
      tokenId: "2",
      role: "staff",
      venue: "v_1",
      scopes: ["knowledge:read"],
    });
    const wrongRole = await authorizeRouteRequest(
      new Request("https://merchant.test/api/memory"),
      {},
      policy("memory.read"),
      {},
      "req-6",
    );
    expect(wrongRole?.status).toBe(403);
  });

  it("never lets PATs use human-only session routes", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      kind: "api-token",
      isApiToken: true,
      sub: "token:3",
      tokenId: "3",
      role: "manager",
      venue: "v_1",
      scopes: ["agent:invoke"],
    });
    for (const id of [
      "auth.refresh",
      "auth.switch-venue",
      "auth.totp.setup",
      "auth.password.set",
      "tokens.create",
      "billing.subscribe",
    ]) {
      const denied = await authorizeRouteRequest(
        new Request("https://merchant.test/api/auth/refresh", {
          method: "POST",
        }),
        {},
        policy(id),
        {},
        `req-${id}`,
      );
      expect(denied?.status, id).toBe(403);
    }
  });

  it("restricts staff PIN rotation to a venue-bound human manager", async () => {
    const request = () =>
      new Request(
        "https://merchant.test/api/staff/291c946b-d6c1-4121-a09a-e779eb9e68ba/pin/reset",
        { method: "POST" },
      );

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "staff@example.com",
      role: "staff",
      venue: "v_1",
    });
    expect(
      (
        await authorizeRouteRequest(
          request(),
          {},
          policy("staff.pin.reset"),
          {},
          "req-pin-staff",
        )
      )?.status,
    ).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "api-token",
      isApiToken: true,
      sub: "token:pin",
      tokenId: "pin",
      role: "manager",
      venue: "v_1",
      scopes: [],
    });
    expect(
      (
        await authorizeRouteRequest(
          request(),
          {},
          policy("staff.pin.reset"),
          {},
          "req-pin-token",
        )
      )?.status,
    ).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "manager@example.com",
      role: "manager",
    });
    expect(
      (
        await authorizeRouteRequest(
          request(),
          {},
          policy("staff.pin.reset"),
          {},
          "req-pin-unbound",
        )
      )?.status,
    ).toBe(403);

    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    });
    expect(
      await authorizeRouteRequest(
        request(),
        {},
        policy("staff.pin.reset"),
        {},
        "req-pin-manager",
      ),
    ).toBeNull();
  });

  it("does not confuse reseller, platform and venue roles", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      kind: "human-jwt",
      sub: "reseller@example.com",
      role: "reseller_admin",
      org: "org_1",
    });
    const venueDenied = await authorizeRouteRequest(
      new Request("https://merchant.test/api/billing"),
      {},
      policy("billing.read"),
      {},
      "req-7",
    );
    expect(venueDenied?.status).toBe(403);

    const orgAllowed = await authorizeRouteRequest(
      new Request("https://merchant.test/api/org/me"),
      {},
      policy("org.me"),
      {},
      "req-8",
    );
    expect(orgAllowed).toBeNull();

    const adminDenied = await authorizeRouteRequest(
      new Request("https://merchant.test/api/admin/session"),
      {},
      policy("admin.session"),
      {},
      "req-9",
    );
    expect(adminDenied?.status).toBe(403);
  });
});
