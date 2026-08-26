import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  let row: { value: unknown; revision: number; updated_at: string } | null = null;
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (/INSERT INTO merchant_state/i.test(text)) {
      if (row) return [];
      row = { value: values[2], revision: 1, updated_at: new Date().toISOString() };
      return [{ revision: 1, updated_at: row.updated_at }];
    }
    if (/UPDATE merchant_state/i.test(text)) {
      const expected = Number(values.at(-1));
      if (!row || row.revision !== expected) return [];
      row = { value: values[0], revision: row.revision + 1, updated_at: new Date().toISOString() };
      return [{ revision: row.revision, updated_at: row.updated_at }];
    }
    if (/SELECT value, revision, updated_at/i.test(text)) return row ? [row] : [];
    return [];
  };
  (sql as typeof sql & { json: (value: unknown) => unknown }).json = (value) => value;
  return { get row() { return row; }, reset: () => { row = null; }, sql };
});

vi.mock("../../src/api/auth", () => ({
  requireHumanAuth: vi.fn(async () => ({ sub: "owner", venue: "main", role: "merchant" })),
}));
vi.mock("../../src/lib/db", () => ({ getSql: () => h.sql }));

import { handleStateRoute } from "../../src/api/state";

function write(value: unknown, revision: number) {
  return handleStateRoute(
    new Request("https://x.dev/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "fxengine.merchant.settings", value, revision }),
    }),
    {},
  );
}

describe("merchant state optimistic concurrency", () => {
  beforeEach(() => h.reset());

  it("creates at revision zero and advances exactly once", async () => {
    expect((await write({ n: 1 }, 0))?.status).toBe(200);
    const updated = await write({ n: 2 }, 1);
    expect(updated?.status).toBe(200);
    expect(await updated?.json()).toMatchObject({ revision: 2 });
  });

  it("rejects a stale device write with the current server revision", async () => {
    await write({ device: "A" }, 0);
    await write({ device: "A2" }, 1);
    const stale = await write({ device: "B" }, 1);
    expect(stale?.status).toBe(409);
    expect(await stale?.json()).toMatchObject({
      error: "state conflict",
      current: { revision: 2 },
    });
  });
});