import { describe, expect, it, vi } from "vitest";

import {
  RATE_LIMIT_SHARDS,
  bucketFor,
  hashKey,
  retryAfterSeconds,
  shardFor,
} from "../../src/lib/rate-limit-shard";
import { RateLimiterShard } from "../../src/rate-limit-do";

describe("shard selection", () => {
  it("always sends the same key to the same shard", () => {
    const key = "POST:auth.login:203.0.113.9";
    expect(shardFor(key)).toBe(shardFor(key));
  });

  it("stays inside the declared shard count", () => {
    for (let i = 0; i < 500; i += 1) {
      const shard = shardFor(`key-${i}`);
      const index = Number(shard.replace("rl-", ""));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(RATE_LIMIT_SHARDS);
    }
  });

  it("spreads keys across shards rather than piling onto one", () => {
    const used = new Set<string>();
    for (let i = 0; i < 2000; i += 1) used.add(shardFor(`ip-10.0.0.${i}`));
    // A hash that degenerates would land everything on a couple of shards and
    // recreate the hot-partition problem this design exists to avoid.
    expect(used.size).toBeGreaterThan(RATE_LIMIT_SHARDS / 2);
  });

  it("hashes deterministically and without collisions on trivial inputs", () => {
    expect(hashKey("a")).toBe(hashKey("a"));
    expect(hashKey("a")).not.toBe(hashKey("b"));
    expect(hashKey("")).toBeGreaterThanOrEqual(0);
  });
});

describe("window arithmetic", () => {
  it("buckets two calls in the same window together", () => {
    const now = 1_700_000_000_000;
    expect(bucketFor("k", 60, now)).toBe(bucketFor("k", 60, now + 5_000));
  });

  it("starts a new bucket once the window rolls", () => {
    const now = 1_700_000_000_000;
    expect(bucketFor("k", 60, now)).not.toBe(bucketFor("k", 60, now + 60_000));
  });

  it("never advises a retry of less than a second", () => {
    const justBeforeRoll = 59_999;
    expect(retryAfterSeconds(justBeforeRoll, 60)).toBeGreaterThanOrEqual(1);
  });
});

async function incr(
  shard: RateLimiterShard,
  key: string,
  limit: number,
  windowSeconds = 60,
) {
  const res = await shard.fetch(
    new Request("https://limiter/incr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, limit, windowSeconds }),
    }),
  );
  return (await res.json()) as {
    count: number;
    limited: boolean;
    remaining: number;
    retryAfter: number;
  };
}

describe("RateLimiterShard", () => {
  it("counts up and limits past the ceiling", async () => {
    const shard = new RateLimiterShard();
    expect((await incr(shard, "k", 3)).limited).toBe(false);
    expect((await incr(shard, "k", 3)).limited).toBe(false);
    expect((await incr(shard, "k", 3)).limited).toBe(false);
    const fourth = await incr(shard, "k", 3);
    expect(fourth.limited).toBe(true);
    expect(fourth.retryAfter).toBeGreaterThan(0);
  });

  it("counts each key independently", async () => {
    const shard = new RateLimiterShard();
    await incr(shard, "a", 1);
    const b = await incr(shard, "b", 1);
    expect(b.limited).toBe(false);
  });

  it("reports the remaining allowance", async () => {
    const shard = new RateLimiterShard();
    expect((await incr(shard, "k", 5)).remaining).toBe(4);
    expect((await incr(shard, "k", 5)).remaining).toBe(3);
  });

  it("frees the counter once the window has passed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const shard = new RateLimiterShard();
      await incr(shard, "k", 1);
      expect((await incr(shard, "k", 1)).limited).toBe(true);
      vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
      expect((await incr(shard, "k", 1)).limited).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a malformed body rather than failing closed on everything", async () => {
    const shard = new RateLimiterShard();
    const res = await shard.fetch(
      new Request("https://limiter/incr", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses a request with no key", async () => {
    const shard = new RateLimiterShard();
    const res = await shard.fetch(
      new Request("https://limiter/incr", {
        method: "POST",
        body: JSON.stringify({ limit: 5 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-POST", async () => {
    const shard = new RateLimiterShard();
    const res = await shard.fetch(new Request("https://limiter/incr"));
    expect(res.status).toBe(405);
  });

  it("treats a nonsense limit as one rather than as unlimited", async () => {
    const shard = new RateLimiterShard();
    await incr(shard, "k", 0);
    expect((await incr(shard, "k", 0)).limited).toBe(true);
  });
});
