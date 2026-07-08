// Pure dispute / chargeback classification + status normalization. Kept dependency-
// free so the webhook path can decide "is this a dispute?" and normalize a provider
// status without pulling in the DB/payments stack, and so it is trivially unit-tested.

// A webhook is a dispute when the resource carries a dispute id, or the event name
// mentions a dispute / chargeback. (Refunds are handled separately.)
export function isDisputeEvent(
  eventType: string,
  resource: Record<string, unknown>,
): boolean {
  return (
    Boolean(resource.dispute_id) || /dispute|chargeback/i.test(eventType || "")
  );
}

// Normalise the many provider dispute statuses to our small lifecycle:
// open → under_review → won | lost | withdrawn.
const DISPUTE_STATUS: Record<string, string> = {
  dispute_opened: "open",
  dispute_created: "open",
  opened: "open",
  open: "open",
  needs_response: "open",
  warning_needs_response: "open",
  under_review: "under_review",
  warning_under_review: "under_review",
  dispute_challenged: "under_review",
  challenged: "under_review",
  won: "won",
  dispute_won: "won",
  warning_closed: "won",
  lost: "lost",
  dispute_lost: "lost",
  dispute_expired: "lost",
  charge_refunded: "lost",
  withdrawn: "withdrawn",
  dispute_cancelled: "withdrawn",
  canceled: "withdrawn",
  cancelled: "withdrawn",
};

export function mapDisputeStatus(status: string | null | undefined): string {
  const key = String(status ?? "").toLowerCase().trim();
  return DISPUTE_STATUS[key] ?? (key || "open");
}
