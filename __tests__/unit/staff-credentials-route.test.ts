import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const state: {
    rows: unknown[];
    calls: Array<{ text: string; values: unknown[] }>;
  } = { rows: [], calls: [] };
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.calls.push({ text: strings.join("?"), values });
    return state.rows;
  };
  return { state, sql };
});

vi.mock("../../src/api/auth", () => ({ requireHumanAuth: vi.fn() }));
vi.mock("../../src/lib/db", () => ({ getSql: vi.fn(() => harness.sql) }));
// Only the deliberately-slow scrypt hash is stubbed. The validation rules stay
// real, so this test fails if the PIN contract changes rather than passing
// against a copy of it that has drifted.
vi.mock("../../src/lib/staff-pin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/staff-pin")>()),
  hashStaffPin: vi.fn(async () => "scrypt-hash"),
}));

import { requireHumanAuth } from "../../src/api/auth";
import { handleStaffRoute } from "../../src/api/staff";
import { hashStaffPin } from "../../src/lib/staff-pin";

const STAFF_ID = "291c946b-d6c1-4121-a09a-e779eb9e68ba";

function resetRequest(pin = "246810") {
  return new Request(`https://merchant.test/api/staff/${STAFF_ID}/pin/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ temporaryPin: pin }),
  });
}

describe("staff credential rotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.rows = [];
    harness.state.calls = [];
  });

  it("rejects a staff caller before hashing or writing", async () => {
    vi.mocked(requireHumanAuth).mockResolvedValue({
      sub: "staff:1",
      role: "staff",
      venue: "v_1",
    } as never);

    const response = await handleStaffRoute(resetRequest(), {});

    expect(response?.status).toBe(403);
    expect(hashStaffPin).not.toHaveBeenCalled();
    expect(harness.state.calls).toEqual([]);
  });

  it("rejects a PIN outside the six-to-eight-digit contract", async () => {
    vi.mocked(requireHumanAuth).mockResolvedValue({
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    } as never);

    const response = await handleStaffRoute(resetRequest("1234"), {});

    expect(response?.status).toBe(400);
    expect(hashStaffPin).not.toHaveBeenCalled();
    expect(harness.state.calls).toEqual([]);
  });

  it("refuses a guessable PIN before hashing or writing", async () => {
    vi.mocked(requireHumanAuth).mockResolvedValue({
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    } as never);

    for (const weak of ["000000", "123456", "121212"]) {
      harness.state.calls = [];
      const response = await handleStaffRoute(resetRequest(weak), {});
      const body = (await response?.json()) as { code?: string };

      expect(response?.status, weak).toBe(400);
      expect(body.code, weak).toBe("weak-pin");
      // The UI blocks these too, but a manager can reach this endpoint directly.
      expect(hashStaffPin).not.toHaveBeenCalled();
      expect(harness.state.calls).toEqual([]);
    }
  });

  it("does not rotate a staff row outside the manager's venue", async () => {
    vi.mocked(requireHumanAuth).mockResolvedValue({
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    } as never);

    const response = await handleStaffRoute(resetRequest(), {});

    expect(response?.status).toBe(404);
    expect(harness.state.calls[0]?.values).toEqual([
      "scrypt-hash",
      STAFF_ID,
      "v_1",
    ]);
  });

  it("stores only the hash and revokes existing staff sessions", async () => {
    vi.mocked(requireHumanAuth).mockResolvedValue({
      sub: "manager@example.com",
      role: "manager",
      venue: "v_1",
    } as never);
    harness.state.rows = [{ id: STAFF_ID }];

    const response = await handleStaffRoute(resetRequest(), {});

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ ok: true });
    expect(hashStaffPin).toHaveBeenCalledWith("246810");
    expect(harness.state.calls[0]?.text).toContain(
      "credential_version = credential_version + 1",
    );
    expect(harness.state.calls[0]?.values).toEqual([
      "scrypt-hash",
      STAFF_ID,
      "v_1",
    ]);
    expect(harness.state.calls[0]?.values).not.toContain("246810");
  });
});
