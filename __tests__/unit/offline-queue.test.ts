import { describe, it, expect } from "vitest";

import {
  backoffMs,
  drainQueue,
  enqueueCharge,
  listQueued,
  queueSize,
  queueStats,
  removeQueued,
  retryNow,
  syncQueue,
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

  it("defaults a stable idempotency key to the sale id", () => {
    const s = memStore();
    enqueueCharge(s, { id: "c1", amount: 100, currency: "KES", metadata: {} });
    expect(listQueued(s)[0].idempotencyKey).toBe("c1");
    enqueueCharge(s, {
      id: "c2",
      amount: 200,
      currency: "KES",
      metadata: {},
      idempotencyKey: "custom-key",
    });
    expect(listQueued(s)[1].idempotencyKey).toBe("custom-key");
  });
});

describe("offline-queue — store-and-forward sync", () => {
  it("computes exponential backoff, capped at 5 minutes", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    // Capped.
    expect(backoffMs(20)).toBe(5 * 60_000);
  });

  it("syncQueue drops successes and backs off failures with the reason", async () => {
    const s = memStore();
    enqueueCharge(s, { id: "ok", amount: 100, currency: "KES", metadata: {} });
    enqueueCharge(s, { id: "bad", amount: 200, currency: "KES", metadata: {} });
    const now = 1_000_000;
    const res = await syncQueue(
      s,
      async (c) =>
        c.id === "ok" ? { ok: true } : { ok: false, error: "server 500" },
      now,
    );
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.remaining).toBe(1);
    const [failed] = listQueued(s);
    expect(failed.id).toBe("bad");
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("server 500");
    expect(failed.nextRetryAt).toBe(now + 5_000);
  });

  it("skips an item still inside its backoff window", async () => {
    const s = memStore();
    enqueueCharge(s, { id: "bad", amount: 200, currency: "KES", metadata: {} });
    const t0 = 1_000_000;
    // First attempt fails -> backoff until t0 + 5s.
    await syncQueue(s, async () => ({ ok: false, error: "x" }), t0);
    // A pass 2s later must SKIP it (still backing off), not retry.
    let sendCalls = 0;
    const res = await syncQueue(
      s,
      async () => {
        sendCalls += 1;
        return { ok: true };
      },
      t0 + 2_000,
    );
    expect(sendCalls).toBe(0);
    expect(res.skipped).toBe(1);
    expect(res.remaining).toBe(1);
    // After the window, it retries and clears.
    const res2 = await syncQueue(s, async () => ({ ok: true }), t0 + 6_000);
    expect(res2.sent).toBe(1);
    expect(queueSize(s)).toBe(0);
  });

  it("retryNow clears the backoff so the item is due immediately", async () => {
    const s = memStore();
    enqueueCharge(s, { id: "bad", amount: 200, currency: "KES", metadata: {} });
    const t0 = 1_000_000;
    await syncQueue(s, async () => ({ ok: false, error: "x" }), t0);
    expect(listQueued(s)[0].nextRetryAt).toBe(t0 + 5_000);
    retryNow(s, "bad");
    expect(listQueued(s)[0].nextRetryAt).toBeUndefined();
    // Now it is due even a moment later, and succeeds.
    const res = await syncQueue(s, async () => ({ ok: true }), t0 + 1);
    expect(res.sent).toBe(1);
  });

  it("queueStats separates pending from backing-off (failed) items", async () => {
    const s = memStore();
    enqueueCharge(s, { id: "p", amount: 100, currency: "KES", metadata: {} });
    enqueueCharge(s, { id: "f", amount: 200, currency: "KES", metadata: {} });
    const now = 1_000_000;
    // Sync once: "p" succeeds and is dropped; "f" fails and starts backing off.
    await syncQueue(
      s,
      async (c) => (c.id === "f" ? { ok: false, error: "x" } : { ok: true }),
      now,
    );
    const stats = queueStats(s, now + 1_000);
    expect(stats.total).toBe(1);
    expect(stats.failed).toBe(1); // "f" is backing off
    expect(stats.pending).toBe(0);
  });
});
