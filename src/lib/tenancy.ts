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
// Caps are per-VENUE row counts, enforced on create (existing data is never
// touched — a merchant already at/over a cap simply cannot add more).
export type PlanLimits = {
  recurring: number;
  staff: number;
  tables: number;
  menu_items: number;
  campaigns: number;
  contacts: number;
  stores: number;
};

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    recurring: 25,
    staff: 5,
    tables: 20,
    menu_items: 50,
    campaigns: 3,
    contacts: 500,
    stores: 2,
  },
  pro: {
    recurring: 1000,
    staff: 200,
    tables: 500,
    menu_items: 2000,
    campaigns: 200,
    contacts: 100000,
    stores: 50,
  },
};

export type PlanEntity = keyof PlanLimits;

export function planOf(payload: Record<string, unknown> | null): string {
  const plan =
    payload && typeof payload.plan === "string" ? payload.plan : null;
  return plan && plan in PLAN_LIMITS ? plan : "pro";
}

// The cap for one entity under a plan (falls back to the pro cap for an unknown
// plan). Pure + unit-tested.
export function planLimit(plan: string, entity: PlanEntity): number {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.pro;
  return limits[entity] ?? PLAN_LIMITS.pro[entity];
}

// A consistent 402 message when a plan cap is reached.
export function planLimitMessage(plan: string, entity: PlanEntity): string {
  const nice: Record<PlanEntity, string> = {
    recurring: "recurring schedules",
    staff: "team members",
    tables: "tables",
    menu_items: "menu items",
    campaigns: "campaigns",
    contacts: "contacts",
    stores: "stores",
  };
  return `Your ${plan} plan allows up to ${planLimit(plan, entity)} ${nice[entity]}. Upgrade to add more.`;
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

// The per-store team roles an owner/manager may assign to a member. Excludes
// `customer` and platform roles (`admin`) — a merchant can only ever create
// roles up to their own within their own store(s).
export const MANAGEABLE_ROLES = [
  "staff",
  "supervisor",
  "manager",
  "merchant",
] as const;
export type ManageableRole = (typeof MANAGEABLE_ROLES)[number];

export function isManageableRole(role: string): role is ManageableRole {
  return (MANAGEABLE_ROLES as readonly string[]).includes(role);
}

// True when a principal holding `callerRole` at a venue may grant `targetRole`
// to a member there. Pure so it is trivially unit-tested and reused by the API:
// the caller must be manager+, the target must be a known team role, and it may
// never outrank the caller (no privilege escalation).
export function canGrantRole(callerRole: string, targetRole: string): boolean {
  const callerRank = ROLE_RANK[callerRole] ?? 0;
  if (callerRank < ROLE_RANK.manager) return false;
  if (!isManageableRole(targetRole)) return false;
  return (ROLE_RANK[targetRole] ?? 99) <= callerRank;
}

// True when a member holding `callerRole` may remove a member holding
// `targetRole` from the same store (manager+, and never someone who outranks
// them). Owner-of-last-resort protection is enforced separately in the API.
export function canRemoveMember(callerRole: string, targetRole: string): boolean {
  const callerRank = ROLE_RANK[callerRole] ?? 0;
  if (callerRank < ROLE_RANK.manager) return false;
  return (ROLE_RANK[targetRole] ?? 0) <= callerRank;
}
