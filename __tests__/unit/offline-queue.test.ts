import { describe, it, expect } from "vitest";

import {
  drainQueue,
  enqueueCharge,
  listQueued,
  queueSize,
  removeQueued,
  type QueueStore,
} from "../../src/lib/offline-queue";

function memStore(): QueueStore {
  let v: string | null = null;
  return {
    get: () => v,
    set: (x) => {
      v = x;
    },
  };
}

describe("offline-queue", () => {
  it("enqueues and lists charges in order", () => {
    const s = memStore();
    enqueueCharge(s, { id: "c1", amount: 100, currency: "KES", metadata: {} });
    enqueueCharge(s, { id: "c2", amount: 200, currency: "KES", metadata: {} });
    expect(queueSize(s)).toBe(2);
    expect(listQueued(s).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(listQueued(s)[0].attempts).toBe(0);
  });

  it("removes a charge by id", () => {
    const s = memStore();
    enqueueCharge(s, { id: "c1", amount: 100, currency: "KES", metadata: {} });
    removeQueued(s, "c1");
    expect(queueSize(s)).toBe(0);
  });

  it("drains successes and keeps failures with incremented attempts", async () => {
    const s = memStore();
    enqueueCharge(s, { id: "ok", amount: 100, currency: "KES", metadata: {} });
    enqueueCharge(s, { id: "fail", amount: 200, currency: "KES", metadata: {} });
    const res = await drainQueue(s, async (c) => c.id === "ok");
    expect(res.sent).toBe(1);
    expect(res.remaining).toBe(1);
    expect(listQueued(s)[0].id).toBe("fail");
    expect(listQueued(s)[0].attempts).toBe(1);
  });

  it("survives corrupt storage", () => {
    const s = memStore();
    s.set("not json");
    expect(queueSize(s)).toBe(0);
  });
});
