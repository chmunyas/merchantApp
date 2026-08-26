import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "../../src/lib/cron-fanout";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("never exceeds the concurrency bound", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(1);
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("visits every item exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 7, async (n) => {
      seen.push(n);
      return n;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i),
    );
  });

  it("handles an empty list without spawning a worker", async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 5, async () => {
      calls += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("treats a nonsense bound as one at a time rather than unbounded", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4], 0, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(1);
      inFlight -= 1;
      return null;
    });
    expect(peak).toBe(1);
  });

  it("does not spawn more workers than there are items", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2], 100, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(1);
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("propagates a rejection so a caller cannot mistake failure for success", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
