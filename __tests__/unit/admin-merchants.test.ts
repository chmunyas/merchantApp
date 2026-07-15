import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/api/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("../../src/lib/db", () => ({ getSql: vi.fn() }));

import { handleAdminRoute } from "../../src/api/admin";
import { requireAuth } from "../../src/api/auth";
import { getSql } from "../../src/lib/db";

const req = (method = "GET") =>
  new Request("https://x.dev/api/admin/merchants", { method });

// A tagged-template stub that resolves to the given rows.
const sqlReturning = (rows: unknown[]) => () => Promise.resolve(rows);

describe("/api/admin/merchants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is 401 without auth", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    const res = await handleAdminRoute(req(), {});
    expect(res!.status).toBe(401);
  });

  it("is 403 for a non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ role: "merchant", venue: "v_1" });
    const res = await handleAdminRoute(req(), {});
    expect(res!.status).toBe(403);
  });

  it("returns the merchants list for an admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ role: "admin" });
    vi.mocked(getSql).mockReturnValue(sqlReturning([]) as never);
    const res = await handleAdminRoute(req(), {});
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ merchants: [] });
  });

  it("verifies an admin session for /api/admin/session", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ role: "admin" });
    const res = await handleAdminRoute(
      new Request("https://x.dev/api/admin/session"),
      {},
    );
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ admin: true });
  });

  it("blocks the session probe for a non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ role: "merchant", venue: "v_1" });
    const res = await handleAdminRoute(
      new Request("https://x.dev/api/admin/session"),
      {},
    );
    expect(res!.status).toBe(403);
  });

  it("ignores unrelated paths", async () => {
    const res = await handleAdminRoute(
      new Request("https://x.dev/api/venues"),
      {},
    );
    expect(res).toBeNull();
  });
});
