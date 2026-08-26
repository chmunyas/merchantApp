// Names the failures we deliberately swallow, so "best effort" does not mean
// "invisible".
//
// The guest-facing payment page has several operations that genuinely must not
// block: a malformed realtime frame, a receipt balance refresh, releasing a
// claim that expires on its own. Each was a bare `catch {}`. Individually
// correct, collectively a blind spot — if one started failing for every guest,
// nothing anywhere would say so.
//
// This adds no network call and no UI. It records the failure under a stable
// name and logs ONCE per name per page load, so a persistent fault is visible in
// a support session without spamming the console mid-payment.

export type BestEffortEvent =
  | "pay.realtime.frame"
  | "pay.realtime.connect"
  | "pay.claim.release"
  | "pay.receipt.balance"
  | "pay.receipt.ref"
  | "pay.review.submit";

const counts = new Map<BestEffortEvent, number>();

/**
 * Records that a non-blocking operation failed. Never throws: a reporting bug
 * must not become the failure it was meant to report.
 */
export function noteBestEffortFailure(
  event: BestEffortEvent,
  error?: unknown,
): void {
  try {
    const seen = (counts.get(event) ?? 0) + 1;
    counts.set(event, seen);
    if (seen === 1) {
      console.warn(`[best-effort] ${event} failed`, error);
    }
  } catch {
    /* reporting must never be the thing that breaks */
  }
}

/** Snapshot for diagnostics, and the single seam a real sink would plug into. */
export function bestEffortFailures(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function resetBestEffortFailures(): void {
  counts.clear();
}
