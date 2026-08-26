// C5.6 / C5.11 — what to tell the POS about a payment, and what to do when it
// does not listen.
//
// Pure and total, so the rules that decide whether a venue's day reconciles can
// be tested without a POS, a database or a clock.

import { isRetryable, type PosFailure } from "@/lib/pos/types";

export type PushStatus =
  | "pending"
  | "notified"
  | "not_notified"
  | "skipped"
  | "manual";

/** Sunday's own vocabulary, shown to staff verbatim. */
export const PUSH_STATUS_LABEL: Readonly<Record<PushStatus, string>> = {
  pending: "Pending",
  notified: "Notified",
  not_notified: "Not Notified",
  skipped: "No POS",
  manual: "Recorded manually",
};

/**
 * Five attempts, then a human. Sunday documents no automatic retry at all — every
 * remedy in its help centre is "record it manually on the POS" — so the ceiling
 * is deliberately low. An unsynced payment is fixed by telling a server, and
 * retrying for an hour first only means the guests have already left.
 */
export const MAX_PUSH_ATTEMPTS = 5;

export type PushIntentInput = {
  hasConnection: boolean;
  connectorCanPush: boolean;
  posBillId: string | null;
  /** What the guest paid us, in minor units, including any tip and guest fee. */
  grossMinor: number;
  tipMinor: number;
  /** The guest's digital fee. Paid to us, not to the venue. */
  guestFeeMinor: number;
};

export type PushIntent =
  | { push: false; status: "skipped"; reason: string }
  | { push: true; posBillId: string; amountMinor: number; tipMinor: number };

/**
 * Decide whether a payment should be told to the POS at all.
 *
 * The amount is subtotal + tip with the guest's digital fee removed. Sunday is
 * explicit that guest fees "are not included in your Sunday figures, as they are
 * paid directly by the guest and are separate from their bill" — pushing one
 * would overstate the check and guarantee a reconciliation gap.
 */
export function planPush(input: PushIntentInput): PushIntent {
  if (!input.hasConnection) {
    return { push: false, status: "skipped", reason: "no POS connected" };
  }
  if (!input.connectorCanPush) {
    return { push: false, status: "skipped", reason: "connector cannot push tenders" };
  }
  if (!input.posBillId) {
    // A payment with no bill behind it (a counter sale, a pay link) has no check
    // to land on. That is not a failure and must not raise an unsynced alert.
    return { push: false, status: "skipped", reason: "payment has no POS bill" };
  }
  const amountMinor = Math.max(0, input.grossMinor - Math.max(0, input.guestFeeMinor));
  if (amountMinor <= 0) {
    return { push: false, status: "skipped", reason: "nothing to record" };
  }
  return {
    push: true,
    posBillId: input.posBillId,
    amountMinor,
    // A tip can never exceed what we are pushing; clamp rather than reject, so a
    // rounding artefact upstream cannot strand a real payment.
    tipMinor: Math.min(Math.max(0, input.tipMinor), amountMinor),
  };
}

export type AttemptOutcome =
  | { ok: true }
  | { ok: false; error: PosFailure };

export type NextAttempt = {
  status: PushStatus;
  /** Seconds until the next try; null when there will not be one. */
  retryInSeconds: number | null;
  /** True the moment a human must be told. Fires once, on the transition. */
  alert: boolean;
};

/**
 * What happens after one attempt.
 *
 * A non-retryable refusal goes straight to `not_notified` — no backoff, because
 * the answer will not change and the server needs to know now. A retryable error
 * backs off exponentially until the attempt ceiling, then does the same.
 */
export function nextAttempt(
  outcome: AttemptOutcome,
  attemptsSoFar: number,
): NextAttempt {
  if (outcome.ok) {
    return { status: "notified", retryInSeconds: null, alert: false };
  }
  const attempts = attemptsSoFar + 1;
  if (!isRetryable(outcome.error) || attempts >= MAX_PUSH_ATTEMPTS) {
    return { status: "not_notified", retryInSeconds: null, alert: true };
  }
  return {
    status: "pending",
    retryInSeconds: Math.min(300, 2 ** attempts * 5),
    alert: false,
  };
}

/**
 * What a server is told when a payment did not reach the POS. Sunday's remedy is
 * always the same and is stated plainly: the money is collected, so record it by
 * hand under the `sunday` method or the check will not close.
 */
export function unsyncedAlertBody(
  amountMinor: number,
  tableLabel: string | null,
  currency = "KES",
): string {
  const amount = (amountMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const where = tableLabel ? ` on table ${tableLabel}` : "";
  return `${currency} ${amount}${where} was paid but did not reach the POS. The money is collected — record it on the POS using the "sunday" payment method so the check closes.`;
}
