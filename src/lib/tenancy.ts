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
  // A token's venue claim always wins (tenant pinning). An authenticated
  // principal WITHOUT a claim may only target a venue via ?venue= when it is a
  // platform admin; any other authenticated caller is pinned to "main". Public
  // (unauthenticated) callers keep the query-param default for public flows.
  if (claim) return claim;
  if (payload && payload.role !== "admin") return "main";
  return url.searchParams.get("venue") || "main";
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

// Role hierarchy for RBAC gating. A higher rank inherits lower-rank abilities
// (e.g. a manager passes a `roleAtLeast(payload, "supervisor")` check).
export const ROLE_RANK: Record<string, number> = {
  customer: 0,
  staff: 1,
  supervisor: 2,
  manager: 3,
  merchant: 4,
  reseller_admin: 4,
  admin: 5,
};

export function roleAtLeast(
  payload: Record<string, unknown> | null,
  min: string,
): boolean {
  const role =
    payload && typeof payload.role === "string" ? payload.role : "customer";
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[min] ?? 99);
}
