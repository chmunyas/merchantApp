// Pure, dependency-free tenancy helpers (isolation + plan limits). Kept in lib
// so they're trivially unit-testable and importable anywhere without pulling in
// the DB/auth stack.

// Tenant isolation: when a token carries a venue claim (self-serve merchants),
// that venue wins over any client-supplied ?venue= — so a valid token cannot be
// pointed at another tenant's data. Admin/demo/session tokens carry no venue and
// fall back to the query param (default "main"), keeping single-venue + public
// flows working.
export function venueFromPayload(
  payload: Record<string, unknown> | null,
  url: URL,
): string {
  const claim =
    payload && typeof payload.venue === "string" ? payload.venue : null;
  return claim || url.searchParams.get("venue") || "main";
}

// Per-tenant plan limits. Tokens without a plan claim (admin/demo/session) are
// treated as unlimited ("pro") so single-venue and demo flows are never capped.
export const PLAN_LIMITS: Record<string, { recurring: number }> = {
  free: { recurring: 25 },
  pro: { recurring: 1000 },
};

export function planOf(payload: Record<string, unknown> | null): string {
  const plan =
    payload && typeof payload.plan === "string" ? payload.plan : null;
  return plan && plan in PLAN_LIMITS ? plan : "pro";
}
