import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bestEffortFailures,
  noteBestEffortFailure,
  resetBestEffortFailures,
} from "../../src/lib/best-effort";

beforeEach(() => {
  resetBestEffortFailures();
  vi.restoreAllMocks();
});

describe("best-effort failure reporting", () => {
  it("counts every occurrence so a persistent fault is visible", () => {
    noteBestEffortFailure("pay.receipt.balance");
    noteBestEffortFailure("pay.receipt.balance");
    noteBestEffortFailure("pay.claim.release");

    expect(bestEffortFailures()).toEqual({
      "pay.receipt.balance": 2,
      "pay.claim.release": 1,
    });
  });

  it("logs once per event, not once per failure", () => {
    // A guest's realtime socket can emit many bad frames in a few seconds. The
    // console must stay readable during a payment.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 20; i += 1) noteBestEffortFailure("pay.realtime.frame");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(bestEffortFailures()["pay.realtime.frame"]).toBe(20);
  });

  it("never throws, even if console.warn itself blows up", () => {
    // Reporting a failure must not become the failure. This runs on the payment
    // path, where a throw would be worse than the thing being reported.
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console is gone");
    });

    expect(() => noteBestEffortFailure("pay.realtime.connect")).not.toThrow();
  });

  it("swallows nothing about the count when reporting is suppressed", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console is gone");
    });
    noteBestEffortFailure("pay.receipt.ref");

    // The count still incremented before the log attempt failed.
    expect(bestEffortFailures()["pay.receipt.ref"]).toBe(1);
  });
});
