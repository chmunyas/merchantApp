// In-flow gratuity helpers. Pure + unit-testable. Amounts are whole KES (the unit
// the guest sees on the pay page); the pay flow converts to minor units when it
// attaches tip_amount to the payment. A tip rides ON TOP of the bill — it is never
// part of the order balance.

export type TipSuggestion = { pct: number; amount: number };

// Suggest tip amounts as percentages of the base (the share the guest is paying).
export function tipSuggestions(
  base: number,
  pcts: number[] = [5, 10, 15],
): TipSuggestion[] {
  const b = Math.max(0, Math.round(base));
  return pcts.map((pct) => ({ pct, amount: Math.round((b * pct) / 100) }));
}

// Normalise a tip to a non-negative whole number, optionally capped.
export function clampTip(tip: number, max?: number): number {
  const t = Math.max(0, Math.round(tip || 0));
  return typeof max === "number" ? Math.min(t, Math.max(0, Math.round(max))) : t;
}
