import type { Sql } from "@/lib/db";
import { PLAN_LIMITS } from "@/lib/tenancy";

// The M-Pesa-billed plan catalogue. Prices are whole KES / month; limits mirror
// PLAN_LIMITS (src/lib/tenancy.ts) so the paywall the UI shows matches what's
// actually enforced. Keep ids in sync with PLAN_LIMITS keys.
export type BillingPlan = {
  id: string;
  name: string;
  priceKes: number; // whole KES per month (0 = free)
  interval: "month";
  tagline: string;
  features: string[];
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    id: "free",
    name: "Free",
    priceKes: 0,
    interval: "month",
    tagline: "Start selling today",
    features: [
      `${PLAN_LIMITS.free.menu_items} menu items`,
      `${PLAN_LIMITS.free.staff} staff`,
      `${PLAN_LIMITS.free.tables} tables`,
      `${PLAN_LIMITS.free.stores} stores`,
      `${PLAN_LIMITS.free.campaigns} campaigns / mo`,
      "Tap & Go M-Pesa payments",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceKes: 2900,
    interval: "month",
    tagline: "Scale the whole business",
    features: [
      `${PLAN_LIMITS.pro.menu_items.toLocaleString()} menu items`,
      `${PLAN_LIMITS.pro.staff} staff`,
      `${PLAN_LIMITS.pro.tables} tables`,
      `${PLAN_LIMITS.pro.stores} stores`,
      `${PLAN_LIMITS.pro.campaigns} campaigns / mo`,
      "Everything in Free, unlocked",
    ],
  },
];

export function findPlan(id: string | null | undefined): BillingPlan | undefined {
  return BILLING_PLANS.find((p) => p.id === id);
}

// Price of a plan in MINOR units (KES cents) — the unit the payments ledger uses.
export function planPriceMinor(id: string): number {
  return Math.max(0, Math.round((findPlan(id)?.priceKes ?? 0) * 100));
}

export function isPaidPlan(id: string): boolean {
  return planPriceMinor(id) > 0;
}

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// Activate/extend a venue's subscription after a SUCCESSFUL billing payment. Sets
// the venue's plan (app_users.plan — the JWT claim, so limits update on the next
// token refresh) and upserts the subscription with a fresh 30-day period. Called
// once per payment from recordLedger's first-success gate, so it never double-runs.
export async function activateSubscription(
  sql: Sql,
  venue: string,
  plan: string,
  paymentId: string,
  amountMinor: number,
): Promise<void> {
  const periodEnd = new Date(Date.now() + PERIOD_MS).toISOString();
  await sql`
    INSERT INTO subscriptions
      (venue_id, plan, status, current_period_end, last_payment_id, amount, updated_at)
    VALUES (${venue}, ${plan}, 'active', ${periodEnd}, ${paymentId}, ${amountMinor}, now())
    ON CONFLICT (venue_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      status = 'active',
      current_period_end = EXCLUDED.current_period_end,
      last_payment_id = EXCLUDED.last_payment_id,
      amount = EXCLUDED.amount,
      updated_at = now()`;
  await sql`UPDATE app_users SET plan = ${plan} WHERE venue_id = ${venue}`;
}

// Immediately move a venue to the Free tier (cancel / downgrade / dunning lapse).
export async function downgradeToFree(sql: Sql, venue: string): Promise<void> {
  await sql`
    INSERT INTO subscriptions (venue_id, plan, status, current_period_end, amount, updated_at)
    VALUES (${venue}, 'free', 'canceled', NULL, 0, now())
    ON CONFLICT (venue_id) DO UPDATE SET
      plan = 'free', status = 'canceled', current_period_end = NULL,
      amount = 0, updated_at = now()`;
  await sql`UPDATE app_users SET plan = 'free' WHERE venue_id = ${venue}`;
}
