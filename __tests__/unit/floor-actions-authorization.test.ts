import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/auth", () => ({
  requireAuth: vi.fn(),
}));

import { requireAuth } from "../../src/api/auth";
import { authorizeRouteRequest } from "../../src/lib/route-authorization";
import { ROUTE_POLICIES, decideRoute } from "../../src/lib/route-policy";

// B3.1 / B3.5 — acting on a bill from the floor must not soften the refund
// boundary. A server may LOOK at their table's payments and resend a receipt;
// only a manager may move money back. These tests pin that boundary so it cannot
// be widened by accident.

function policy(id: string) {
  const found = ROUTE_POLICIES.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing policy ${id}`);
  return found;
}

const human = (role: string, venue: string | null = "v_1") => ({
  kind: "human-jwt",
  sub: `${role}@example.com`,
  role,
  ...(venue ? { venue } : {}),
});

const apiToken = (role: string, scopes: string[]) => ({
  kind: "api-token",
  isApiToken: true,
  sub: "tok_1",
  role,
  venue: "v_1",
  scopes,
});

describe("floor actions — declared policy", () => {
  it("keeps refunds manager+ with payments:write", () => {
    const refund = policy("payments.refund");
    expect(refund.minimumVenueRole).toBe("manager");
    expect(refund.scopes).toEqual(["payments:write"]);
    expect(refund.sensitivity).toBe("financial");
    expect(refund.access).toBe("human-or-api-token");
  });

  it("classifies the table payments read as financial and scopes it to payments", () => {
    const read = policy("tables.payments");
    expect(read.sensitivity).toBe("financial");
    expect(read.minimumVenueRole).toBe("staff");
    // Payment data is NOT unlocked by a tables scope.
    expect(read.scopes).toEqual(["payments:read"]);
    expect(read.tenant).toBe("principalVenue");
  });

  it("classifies the receipt resend as guest PII, staff level, write-scoped", () => {
    const resend = policy("orders.receipt");
    expect(resend.sensitivity).toBe("pii");
    expect(resend.minimumVenueRole).toBe("staff");
    expect(resend.scopes).toEqual(["orders:write"]);
  });

  it("routes the new floor paths to their declared handlers", () => {
    expect(
      decideRoute("GET", "/api/tables/8f14e45f-ceea-467a-9575-1e2b1c1b1a11/payments"),
    ).toMatchObject({ kind: "match", route: { policy: { id: "tables.payments" } } });
    expect(
      decideRoute("POST", "/api/orders/8f14e45f-ceea-467a-9575-1e2b1c1b1a11/receipt"),
    ).toMatchObject({ kind: "match", route: { policy: { id: "orders.receipt" } } });
  });

  it("refuses the wrong method on the floor paths rather than falling through", () => {
    expect(
      decideRoute("POST", "/api/tables/8f14e45f-ceea-467a-9575-1e2b1c1b1a11/payments"),
    ).toMatchObject({ kind: "method-not-allowed" });
  });
});

describe("floor actions — enforced authorization", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockReset();
  });

  const authorize = (id: string, method = "GET", path = "/api/refunds") =>
    authorizeRouteRequest(
      new Request(`https://merchant.test${path}`, { method }),
      {},
      policy(id),
      {},
      "req-floor",
    );

  it("denies a server the refund route", async () => {
    vi.mocked(requireAuth).mockResolvedValue(human("staff"));
    const denied = await authorize("payments.refund", "POST");
    expect(denied?.status).toBe(403);
  });

  it("denies a supervisor the refund route", async () => {
    vi.mocked(requireAuth).mockResolvedValue(human("supervisor"));
    const denied = await authorize("payments.refund", "POST");
    expect(denied?.status).toBe(403);
  });

  it("allows a manager the refund route", async () => {
    vi.mocked(requireAuth).mockResolvedValue(human("manager"));
    expect(await authorize("payments.refund", "POST")).toBeNull();
  });

  it("denies an anonymous caller the refund route", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    const denied = await authorize("payments.refund", "POST");
    expect(denied?.status).toBe(401);
  });

  it("denies an API token that holds only payments:read on refunds", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      apiToken("manager", ["payments:read"]),
    );
    const denied = await authorize("payments.refund", "POST");
    expect(denied?.status).toBe(403);
  });

  it("denies a manager-scoped token whose role is only staff on refunds", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      apiToken("staff", ["payments:write"]),
    );
    const denied = await authorize("payments.refund", "POST");
    expect(denied?.status).toBe(403);
  });

  it("lets a server read their table's payments", async () => {
    vi.mocked(requireAuth).mockResolvedValue(human("staff"));
    expect(
      await authorize("tables.payments", "GET", "/api/tables/t1/payments"),
    ).toBeNull();
  });

  it("still requires a venue claim to read a table's payments", async () => {
    vi.mocked(requireAuth).mockResolvedValue(human("staff", null));
    const denied = await authorize(
      "tables.payments",
      "GET",
      "/api/tables/t1/payments",
    );
    expect(denied?.status).toBe(403);
  });

  it("refuses a table payments read to a token without payments:read", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      apiToken("manager", ["tables:read"]),
    );
    const denied = await authorize(
      "tables.payments",
      "GET",
      "/api/tables/t1/payments",
    );
    expect(denied?.status).toBe(403);
  });

  it("lets a server resend the bill but not with a read-only token", async () => {
    vi.mocked(requireAuth).mockResolvedValue(human("staff"));
    expect(
      await authorize("orders.receipt", "POST", "/api/orders/o1/receipt"),
    ).toBeNull();

    vi.mocked(requireAuth).mockResolvedValue(apiToken("staff", ["orders:read"]));
    const denied = await authorize(
      "orders.receipt",
      "POST",
      "/api/orders/o1/receipt",
    );
    expect(denied?.status).toBe(403);
  });
});
