// The approval gate every payout run passes through, and the rule that decides
// whether money may leave.
//
// Nothing here touches the database or the network on purpose: "may this run be
// submitted?" is the single most consequential question in the payout path, and
// it should be answerable in a test without a Postgres or a provider.

export type PayoutRunKind = "tips" | "salary";

export type PayoutRunStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "submitted"
  | "completed"
  | "cancelled";

export const PAYOUT_RUN_KINDS: readonly PayoutRunKind[] = ["tips", "salary"];

/**
 * The only statuses from which the provider may be called.
 *
 * `submitted` is included so a batch that partially failed can be retried
 * without a second approval — the authorisation already happened, and forcing a
 * re-approval to finish paying the remaining people would strand them.
 */
const SUBMITTABLE: readonly PayoutRunStatus[] = ["approved", "submitted"];

export function canSubmit(status: string | null | undefined): boolean {
  return SUBMITTABLE.includes(status as PayoutRunStatus);
}

const TRANSITIONS: Record<PayoutRunStatus, readonly PayoutRunStatus[]> = {
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["submitted", "cancelled"],
  rejected: [],
  submitted: ["completed"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: string, to: PayoutRunStatus): boolean {
  return (TRANSITIONS[from as PayoutRunStatus] ?? []).includes(to);
}

export type ApprovalDecision =
  | { ok: true; selfApproved: boolean }
  | { ok: false; reason: "not-pending" | "empty-run" };

/**
 * Decides whether an approval may proceed, and whether it is a self-approval.
 *
 * House policy permits a manager to approve a run that pays them. It does NOT
 * permit that to be invisible — `selfApproved` is persisted so the fact is on
 * the record rather than something an auditor has to reconstruct.
 */
export function decideApproval(input: {
  status: string;
  staffCount: number;
  totalAmount: number;
  approverStaffId: string | null;
  payeeStaffIds: readonly string[];
}): ApprovalDecision {
  if (input.status !== "pending_approval") return { ok: false, reason: "not-pending" };
  // An empty run has nothing to authorise, and approving one would put an
  // approval record against a payment that never existed.
  if (input.staffCount <= 0 || input.totalAmount <= 0) {
    return { ok: false, reason: "empty-run" };
  }
  const selfApproved =
    input.approverStaffId !== null && input.payeeStaffIds.includes(input.approverStaffId);
  return { ok: true, selfApproved };
}

/** A run is finished once no line can still change. */
export function runIsComplete(
  lineStatuses: readonly string[],
): boolean {
  if (lineStatuses.length === 0) return false;
  return lineStatuses.every((status) =>
    ["confirmed", "failed", "held"].includes(status),
  );
}

/** '2026-08' — the period a fixed monthly salary run belongs to. */
export function salaryPeriodLabel(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
