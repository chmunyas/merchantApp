import {
  ROLE_RANK,
  isVenueRole,
  roleAtLeast as roleAtLeastCanonical,
  type AppRole,
} from "@/lib/tenancy";

export { ROLE_RANK } from "@/lib/tenancy";

// Minimum role rank required to open a dashboard route. Routes NOT listed here
// are open to every signed-in dashboard role (front-of-house operations: orders,
// tables, payments, bookings, inbox, contacts, QR, etc.).
const ROUTE_MIN_RANK: ReadonlyArray<readonly [string, number]> = [
  // Owner-only: configuration, channel API keys, staff management, billing/plan.
  ["/dashboard/settings", ROLE_RANK.merchant],
  ["/dashboard/billing", ROLE_RANK.merchant],
  ["/dashboard/staff", ROLE_RANK.merchant],
  ["/dashboard/whatsapp", ROLE_RANK.merchant],
  ["/dashboard/telegram", ROLE_RANK.merchant],
  // Manager+: financials, catalogue/price edits, automations, analytics.
  ["/dashboard/accounting", ROLE_RANK.manager],
  ["/dashboard/settlement", ROLE_RANK.manager],
  ["/dashboard/fees", ROLE_RANK.manager],
  ["/dashboard/disputes", ROLE_RANK.manager],
  ["/dashboard/api-keys", ROLE_RANK.manager],
  ["/dashboard/payment-methods", ROLE_RANK.manager],
  // Approving a payout run and setting salaries are both manager acts; without
  // this the nav offers staff a page that answers 403 to everything on it.
  ["/dashboard/payouts", ROLE_RANK.manager],
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

export function canAccessPath(role: AppRole, path: string): boolean {
  // Platform and organization principals use their own dedicated surfaces; they
  // never inherit a venue dashboard through a numeric role comparison.
  return isVenueRole(role) && ROLE_RANK[role] >= minRankForPath(path);
}

// Server-side guard: does this JWT payload's role meet the minimum rank? Use in
// API handlers to enforce the same RBAC the UI applies (defense in depth). This
// module has no runtime dependency on the client auth context (type-only import).
export function roleAtLeast(
  payload: { role?: unknown } | null,
  min: AppRole,
): boolean {
  return roleAtLeastCanonical(
    payload as Record<string, unknown> | null,
    min,
  );
}

export type { AppRole, VenueRole } from "@/lib/tenancy";
