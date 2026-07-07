// Self-service bill splitting. Pure + unit-testable. All amounts are MINOR units
// (cents) to match orders.total + the payments ledger, so equal splits distribute
// the remainder cents exactly (no lost/'found' money). This is the math behind
// "pay your share" against one shared order that tracks its balance to zero.

export type SplitLineItem = { name: string; qty: number; price: number }; // price = minor units/unit

// Split `total` across `parties`, giving the leftover cents to the first parties so
// the shares sum EXACTLY to `total`.
export function equalShares(total: number, parties: number): number[] {
  const n = Math.max(1, Math.floor(parties));
  const t = Math.max(0, Math.round(total));
  const base = Math.floor(t / n);
  const remainderCents = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainderCents ? 1 : 0));
}

// One party's share when they pick specific line items (by index).
export function byItemShare(
  items: SplitLineItem[],
  selectedIndexes: number[],
): number {
  const set = new Set(selectedIndexes);
  return items.reduce(
    (sum, it, i) =>
      set.has(i) ? sum + Math.max(1, it.qty) * Math.max(0, it.price) : sum,
    0,
  );
}

// Remaining balance on the order, never below zero.
export function remaining(total: number, paid: number): number {
  return Math.max(0, Math.round(total) - Math.round(paid));
}

// Clamp a requested share to what is actually still owed (0..remaining) — the
// server-authoritative guard that stops a guest over-paying a shared bill.
export function clampShare(requested: number, remainingBalance: number): number {
  const r = Math.max(0, Math.round(requested));
  return Math.min(r, Math.max(0, Math.round(remainingBalance)));
}

// Do custom per-party amounts add up to the whole bill?
export function validateCustom(
  total: number,
  amounts: number[],
): { valid: boolean; sum: number; diff: number } {
  const sum = amounts.reduce((s, a) => s + Math.max(0, Math.round(a)), 0);
  const diff = Math.round(total) - sum;
  return { valid: diff === 0, sum, diff };
}
