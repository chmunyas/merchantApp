import { describe, expect, it } from "vitest";

import {
  DEPTH_CRITICAL,
  DEPTH_WARN,
  STALE_CRITICAL_SECONDS,
  STALE_WARN_SECONDS,
  judgeMoney,
  judgeQueue,
  overallSeverity,
} from "../../src/lib/ops-health";

const queue = (over: Partial<Parameters<typeof judgeQueue>[0]> = {}) =>
  judgeQueue({ name: "q", depth: 0, oldestSeconds: null, failed: 0, stalled: 0, ...over });

describe("queue health — depth alone is not a signal", () => {
  it("calls a deep but fast-moving queue healthy", () => {
    // The whole point: 400 items that arrived a minute ago are a busy service,
    // not an incident. Alerting on depth alone trains people to ignore alerts.
    expect(queue({ depth: 400, oldestSeconds: 30 }).severity).toBe("ok");
  });

  it("calls a shallow but frozen queue critical", () => {
    // Three items nobody has touched for an hour means the worker is dead.
    const verdict = queue({ depth: 3, oldestSeconds: STALE_CRITICAL_SECONDS });
    expect(verdict.severity).toBe("critical");
    expect(verdict.reason).toContain("worker is probably not running");
  });

  it("warns before it pages", () => {
    expect(queue({ depth: 1, oldestSeconds: STALE_WARN_SECONDS }).severity).toBe("warn");
    expect(queue({ depth: 1, oldestSeconds: STALE_WARN_SECONDS - 1 }).severity).toBe("ok");
  });
});

describe("queue health — dead letters outrank everything", () => {
  it("is critical even when the queue is otherwise empty and fresh", () => {
    // Exhausted retries are the only state that never recovers on its own, so a
    // quiet queue with one dead letter is worse than a deep one that is draining.
    const verdict = queue({ depth: 0, oldestSeconds: null, failed: 1 });
    expect(verdict.severity).toBe("critical");
    expect(verdict.reason).toContain("manual retry");
  });

  it("outranks a merely deep queue", () => {
    expect(queue({ depth: DEPTH_CRITICAL, failed: 2 }).reason).toContain("exhausted");
  });
});

describe("queue health — depth and stalled leases", () => {
  it("escalates on depth at the configured thresholds", () => {
    expect(queue({ depth: DEPTH_WARN }).severity).toBe("warn");
    expect(queue({ depth: DEPTH_CRITICAL }).severity).toBe("critical");
    expect(queue({ depth: DEPTH_WARN - 1 }).severity).toBe("ok");
  });

  it("warns rather than pages on an expired lease, because it self-heals", () => {
    const verdict = queue({ depth: 2, stalled: 4 });
    expect(verdict.severity).toBe("warn");
    expect(verdict.reason).toContain("lease expiry");
  });

  it("treats an empty queue's null age as zero, not as stale", () => {
    expect(queue({ depth: 0, oldestSeconds: null }).severity).toBe("ok");
  });
});

describe("stuck money", () => {
  const money = (over: Partial<Parameters<typeof judgeMoney>[0]> = {}) =>
    judgeMoney({
      name: "payout_runs_awaiting_approval",
      count: 0,
      amountMinor: 0,
      oldestSeconds: null,
      toleranceHours: 48,
      ...over,
    });

  it("says nothing when there is nothing held", () => {
    expect(money()).toMatchObject({ severity: "ok", reason: null });
  });

  it("shows recent holds without raising them", () => {
    // A payout run created an hour ago is waiting, not stuck. Reported so it is
    // visible, not escalated so it stays meaningful.
    const verdict = money({ count: 2, oldestSeconds: 3600 });
    expect(verdict.severity).toBe("ok");
    expect(verdict.reason).toContain("within tolerance");
  });

  it("warns past tolerance and pages at double", () => {
    expect(money({ count: 1, oldestSeconds: 48 * 3600 }).severity).toBe("warn");
    expect(money({ count: 1, oldestSeconds: 96 * 3600 }).severity).toBe("critical");
  });

  it("applies a tight tolerance to in-flight payments", () => {
    // An M-Pesa prompt resolves in minutes or never — a day-old "processing"
    // payment is money in limbo.
    const verdict = judgeMoney({
      name: "payments_in_flight",
      count: 5,
      amountMinor: 50_000,
      oldestSeconds: 3 * 3600,
      toleranceHours: 1,
    });
    expect(verdict.severity).toBe("critical");
  });
});

describe("a broken probe must never read as healthy", () => {
  // Found for real: `financial_outbox` has no `created_at`, so the original
  // query threw and the catch reported depth 0 — a dead queue rendered as a
  // perfectly healthy empty one. A monitor that lies is worse than none,
  // because it is trusted.
  it("reports a failed queue probe as critical, not as zero", () => {
    const verdict = queue({ error: 'column "created_at" does not exist' });
    expect(verdict.severity).toBe("critical");
    expect(verdict.reason).toContain("health probe failed");
    expect(verdict.depth).toBe(0);
  });

  it("reports a failed money probe as critical even with a zero count", () => {
    const verdict = judgeMoney({
      name: "tip_payouts_held",
      count: 0,
      amountMinor: 0,
      oldestSeconds: null,
      toleranceHours: 72,
      error: "relation does not exist",
    });
    expect(verdict.severity).toBe("critical");
    expect(verdict.reason).toContain("health probe failed");
  });

  it("outranks every other queue signal", () => {
    expect(queue({ depth: 0, failed: 0, error: "boom" }).reason).toContain("probe failed");
  });
});

describe("overall severity", () => {
  it("is the worst of its parts, so 'ok' means nothing is wrong anywhere", () => {
    expect(overallSeverity([{ severity: "ok" }, { severity: "warn" }])).toBe("warn");
    expect(overallSeverity([{ severity: "warn" }, { severity: "critical" }])).toBe("critical");
    expect(overallSeverity([{ severity: "ok" }, { severity: "ok" }])).toBe("ok");
  });

  it("is ok when there is nothing to judge", () => {
    expect(overallSeverity([])).toBe("ok");
  });
});
