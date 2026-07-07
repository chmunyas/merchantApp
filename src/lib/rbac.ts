import type { UserRole } from "@/lib/auth";

// Higher rank = more privilege. Front-of-house < shift lead < manager < owner.
export const ROLE_RANK: Record<UserRole, number> = {
  customer: 0,
  staff: 1,
  supervisor: 2,
  manager: 3,
  merchant: 4,
  admin: 5,
  reseller_admin: 5,
};

// Minimum role rank required to open a dashboard route. Routes NOT listed here
// are open to every signed-in dashboard role (front-of-house operations: orders,
// tables, payments, bookings, inbox, contacts, QR, etc.).
const ROUTE_MIN_RANK: ReadonlyArray<readonly [string, number]> = [
  // Owner-only: configuration, channel API keys, staff management, billing/plan.
  ["/dashboard/settings", ROLE_RANK.merchant],
  ["/dashboard/staff", ROLE_RANK.merchant],
  ["/dashboard/whatsapp", ROLE_RANK.merchant],
  ["/dashboard/telegram", ROLE_RANK.merchant],
  // Manager+: financials, catalogue/price edits, automations, analytics.
  ["/dashboard/accounting", ROLE_RANK.manager],
  ["/dashboard/settlement", ROLE_RANK.manager],
  ["/dashboard/reports", ROLE_RANK.manager],
  ["/dashboard/analytics", ROLE_RANK.manager],
  ["/dashboard/forecast", ROLE_RANK.manager],
  ["/dashboard/pricing", ROLE_RANK.manager],
  ["/dashboard/retention", ROLE_RANK.manager],
  ["/dashboard/reorder", ROLE_RANK.manager],
  ["/dashboard/menu", ROLE_RANK.manager],
  ["/dashboard/automations", ROLE_RANK.manager],
  ["/dashboard/promos", ROLE_RANK.manager],
  ["/dashboard/knowledge", ROLE_RANK.manager],
];

// Longest-prefix match so a nested path inherits its parent's gate.
export function minRankForPath(path: string): number {
  let best = ROLE_RANK.staff;
  let bestLen = 0;
  for (const [prefix, rank] of ROUTE_MIN_RANK) {
    if (
      (path === prefix || path.startsWith(`${prefix}/`)) &&
      prefix.length > bestLen
    ) {
      best = rank;
      bestLen = prefix.length;
    }
  }
  return best;
}

export function canAccessPath(role: UserRole, path: string): boolean {
  return (ROLE_RANK[role] ?? 0) >= minRankForPath(path);
}

// Server-side guard: does this JWT payload's role meet the minimum rank? Use in
// API handlers to enforce the same RBAC the UI applies (defense in depth). This
// module has no runtime dependency on the client auth context (type-only import).
export function roleAtLeast(
  payload: { role?: unknown } | null,
  min: UserRole,
): boolean {
  const role =
    payload && typeof payload.role === "string"
      ? (payload.role as UserRole)
      : undefined;
  return role ? (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min] : false;
}
