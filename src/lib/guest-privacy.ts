// A5.6 — what a guest may have erased, what the business must keep, and the
// exact shape of a redaction.
//
// Sunday help centre article 7669638 ("I would like to delete or modify my
// sunday account") gives the guest two doors: self-serve inside the staff app,
// or "contact our team". This module is the honest version of the second door:
// a guest asks, a human decides, and the *effect* of agreeing is bounded here
// rather than in an ad-hoc SQL statement.
//
// The boundary, stated once so the UI and the API can quote the same words:
//
//   * Personal IDENTIFIERS are erasable — name, phone, email, free-text notes
//     and tags a venue wrote about the guest.
//   * FINANCIAL RECORDS are retained — payments, refunds, invoices, tips and
//     ledger entries. They are business records with a statutory retention
//     period, and deleting them would corrupt the trial balance and the tax
//     position. Redaction removes the *identity* from those records, not the
//     records.
//
// Everything below is pure: no database, no clock, no environment. That is what
// makes the redaction verifiable by a test rather than by inspection.

export type DataRequestKind = "erasure" | "rectification";
export type DataRequestStatus =
  | "received"
  | "in_review"
  | "completed"
  | "rejected";

export const DATA_REQUEST_KINDS: readonly DataRequestKind[] = [
  "erasure",
  "rectification",
];

export const DATA_REQUEST_STATUSES: readonly DataRequestStatus[] = [
  "received",
  "in_review",
  "completed",
  "rejected",
];

export function isDataRequestKind(value: unknown): value is DataRequestKind {
  return DATA_REQUEST_KINDS.includes(value as DataRequestKind);
}

export function isDataRequestStatus(
  value: unknown,
): value is DataRequestStatus {
  return DATA_REQUEST_STATUSES.includes(value as DataRequestStatus);
}

/** Shown verbatim to the guest so the promise and the code cannot drift. */
export const ERASABLE_CATEGORIES: readonly string[] = [
  "Your name as the venue stored it",
  "Your phone number and email address",
  "Notes and tags the venue added to your customer record",
  "Your marketing contact preferences",
];

/** Shown verbatim to the guest. These survive an erasure, by law. */
export const RETAINED_CATEGORIES: readonly string[] = [
  "Payments, refunds and the amounts on them",
  "Invoices and receipts already issued",
  "Tips paid to staff and their payout records",
  "Accounting journal entries and the audit trail",
];

/** The placeholder a redacted contact carries. Never a real guest name. */
export const REDACTED_NAME = "Redacted guest";

export type ContactPii = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  tags?: readonly string[] | null;
};

export type RedactedContact = {
  name: string;
  phone: null;
  email: null;
  notes: null;
  tags: readonly string[];
};

/**
 * The erased form of a contact row. Aggregates the venue needs for accounting
 * (points, total_spent, visits) are intentionally NOT touched — they are money
 * facts, and this function is not allowed to move money.
 */
export function redactContactFields(_contact: ContactPii): RedactedContact {
  return {
    name: REDACTED_NAME,
    phone: null,
    email: null,
    notes: null,
    tags: [],
  };
}

/** Metadata keys on a payment that carry guest identity rather than money. */
const PAYMENT_PII_KEYS: readonly string[] = [
  "customer_phone",
  "customer_name",
  "customer_email",
  "customerPhone",
  "customerName",
  "customerEmail",
  "phone",
  "email",
  "name",
  "payer_name",
  "payer_phone",
];

/**
 * Strips guest identity from a payment's metadata while leaving every field
 * that reconciliation, settlement or the ledger depends on (order_id, table,
 * provider references, fee components) exactly as it was.
 *
 * `redactedAt` is supplied by the caller so this stays pure and testable.
 */
export function redactPaymentMetadata(
  metadata: Record<string, unknown> | null | undefined,
  redactedAt: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  for (const key of PAYMENT_PII_KEYS) delete next[key];
  next.pii_redacted_at = redactedAt;
  return next;
}

/**
 * Guard used by the tests and by the erasure handler: true when no fragment of
 * the supplied identifier survives anywhere in the redacted payload.
 *
 * Phone-like inputs are compared on their last 9 digits — the national
 * significant number — so `+254712345678`, `254712345678` and `0712 345 678`
 * all count as the same leak. This is deliberately over-sensitive: a false
 * positive costs one skipped row, a false negative leaks a guest's number.
 */
export function containsIdentifier(
  payload: unknown,
  identifier: string,
): boolean {
  const needle = identifier.trim().toLowerCase();
  if (!needle) return false;
  const haystack = JSON.stringify(payload ?? null).toLowerCase();
  if (haystack.includes(needle)) return true;
  const digits = needle.replace(/\D/g, "");
  if (digits.length >= 9) {
    const haystackDigits = haystack.replace(/\D/g, "");
    if (haystackDigits.includes(digits.slice(-9))) return true;
  }
  return false;
}
