// Turns raw queue counts into an operational verdict.
//
// Every asynchronous path in this app fails the same way: quietly and slowly.
// Nothing errors, work simply stops moving. A depth number alone does not say
// whether that is happening — a queue of 500 that is draining is healthy, and a
// queue of 3 that has not moved for a day is not. Age and failure count are what
// distinguish them, so all three travel together.
//
// Pure on purpose: the thresholds are the judgement call, and they should be
// arguable in a test rather than buried in SQL.

export type Severity = "ok" | "warn" | "critical";

export type QueueSample = {
  name: string;
  /** Items waiting to be processed. */
  depth: number;
  /** Seconds the oldest due item is OVERDUE by, or null when nothing is due. */
  oldestSeconds: number | null;
  /** Items that have exhausted their retries and will never move on their own. */
  failed: number;
  /** Claims whose lease expired mid-flight — a worker died holding them. */
  stalled?: number;
  /** Set when the probe itself failed. Zeros would read as healthy. */
  error?: string | null;
};

export type QueueVerdict = QueueSample & {
  severity: Severity;
  reason: string | null;
};

/** Anything older than this is not "busy", it is stuck. */
export const STALE_WARN_SECONDS = 15 * 60;
export const STALE_CRITICAL_SECONDS = 60 * 60;
export const DEPTH_WARN = 500;
export const DEPTH_CRITICAL = 5_000;

export function judgeQueue(sample: QueueSample): QueueVerdict {
  // A probe that cannot run tells us nothing, and "nothing" must never be
  // rendered as zero — a monitor that reports a broken check as healthy is worse
  // than no monitor, because it is trusted.
  if (sample.error) {
    return {
      ...sample,
      severity: "critical",
      reason: `health probe failed: ${sample.error}`,
    };
  }

  const age = sample.oldestSeconds ?? 0;
  const stalled = sample.stalled ?? 0;

  // Dead letters first: they are the only category that never recovers on its
  // own, so they outrank a merely deep queue.
  if (sample.failed > 0) {
    return {
      ...sample,
      severity: "critical",
      reason: `${sample.failed} item(s) exhausted their retries and need a manual retry`,
    };
  }
  if (age >= STALE_CRITICAL_SECONDS) {
    return {
      ...sample,
      severity: "critical",
      reason: `oldest item is ${Math.round(age / 60)} minutes overdue — the worker is probably not running`,
    };
  }
  if (sample.depth >= DEPTH_CRITICAL) {
    return { ...sample, severity: "critical", reason: `depth ${sample.depth} is beyond drain rate` };
  }
  if (stalled > 0) {
    return {
      ...sample,
      severity: "warn",
      reason: `${stalled} claim(s) held by a worker that stopped — they free on lease expiry`,
    };
  }
  if (age >= STALE_WARN_SECONDS) {
    return {
      ...sample,
      severity: "warn",
      reason: `oldest item is ${Math.round(age / 60)} minutes overdue`,
    };
  }
  if (sample.depth >= DEPTH_WARN) {
    return { ...sample, severity: "warn", reason: `depth ${sample.depth} is climbing` };
  }
  return { ...sample, severity: "ok", reason: null };
}

export type MoneySample = {
  name: string;
  count: number;
  amountMinor: number;
  oldestSeconds: number | null;
  /** Hours after which frozen money stops being normal and becomes a problem. */
  toleranceHours: number;
  error?: string | null;
};

export type MoneyVerdict = MoneySample & { severity: Severity; reason: string | null };

/**
 * Money that is not moving.
 *
 * Deliberately separate from queue health: a stuck queue is an engineering
 * problem, whereas an unapproved payout run is somebody not doing something.
 * Both stop people being paid, and only one of them is fixed by a redeploy.
 */
export function judgeMoney(sample: MoneySample): MoneyVerdict {
  if (sample.error) {
    return { ...sample, severity: "critical", reason: `health probe failed: ${sample.error}` };
  }
  if (sample.count === 0) return { ...sample, severity: "ok", reason: null };
  const hours = (sample.oldestSeconds ?? 0) / 3600;
  if (hours >= sample.toleranceHours * 2) {
    return {
      ...sample,
      severity: "critical",
      reason: `${sample.count} held for ${Math.round(hours)}h`,
    };
  }
  if (hours >= sample.toleranceHours) {
    return {
      ...sample,
      severity: "warn",
      reason: `${sample.count} held for ${Math.round(hours)}h`,
    };
  }
  // Present but recent: worth showing, not worth waking anyone.
  return { ...sample, severity: "ok", reason: `${sample.count} awaiting, within tolerance` };
}

/** The worst verdict wins — an overall "ok" must mean nothing is wrong anywhere. */
export function overallSeverity(verdicts: readonly { severity: Severity }[]): Severity {
  if (verdicts.some((v) => v.severity === "critical")) return "critical";
  if (verdicts.some((v) => v.severity === "warn")) return "warn";
  return "ok";
}
