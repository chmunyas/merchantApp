// Auto-gratuity-aware tip tiering (roadmap A3.2).
//
// Sunday's documented rule — https://intercom.help/sundayapp-help/en/articles/
// 11589836-understanding-auto-gratuity-how-additional-tip-options-work-on-sunday
//
//   included < 10%   → standard options 20 / 23 / 25%
//   included 10–17%  → pro-rate so the COMBINED gratuity lands at ~20 / 23 / 25%
//   included > 17%   → reduced options 3 / 5 / 7%
//
// The included gratuity is a property of the BILL (a POS service-charge or
// auto-gratuity line), never of our own config — Sunday is explicit that
// auto-gratuity is configured in the POS. When the bill carries no service
// charge, or we simply do not know it, this degrades to the standard tiers.
//
// Percentages are expressed against the PRE-GRATUITY base (the food/drink
// subtotal), which is what a POS auto-gratuity is a percentage of, and what the
// guest is shown ("12% already included, add 8%"). Amounts are whole currency
// units — the unit the pay page renders. A tip always rides ON TOP of the bill.

export type TipTierBand = "standard" | "prorated" | "reduced";

export type TipTier = {
  /** Additional tip, as a % of the pre-gratuity base. */
  pct: number;
  /** Additional tip in whole currency units. */
  amount: number;
  /** included + additional, as a % of the pre-gratuity base. */
  combinedPct: number;
};

export type TipTierPlan = {
  band: TipTierBand;
  /** Gratuity already on the bill, as a % of the pre-gratuity base. */
  includedPct: number;
  /** Gratuity already on the bill, in whole currency units. */
  includedAmount: number;
  /** The base the tier percentages are applied to. */
  base: number;
  tiers: TipTier[];
};

/** Shown when little or no gratuity is already on the bill. */
export const STANDARD_TIP_PCTS = [20, 23, 25] as const;
/** Shown when the guest has already tipped generously. */
export const REDUCED_TIP_PCTS = [3, 5, 7] as const;
/** Combined (included + additional) gratuity the pro-rated band aims for. */
export const COMBINED_TIP_TARGETS = [20, 23, 25] as const;

/** Below this the included gratuity is treated as negligible. */
export const PRORATE_LOWER_PCT = 10;
/** Above this the guest is treated as already generously tipped. */
export const PRORATE_UPPER_PCT = 17;
/** A pro-rated suggestion is never offered below this. */
export const MIN_ADDITIONAL_TIP_PCT = 1;

function safe(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * The included gratuity as a percentage of the pre-gratuity base.
 * `billTotal` includes the gratuity; `includedGratuity` is the part of it that
 * is a service charge / auto-gratuity. Returns 0 when there is nothing included
 * and `Infinity` when the bill is gratuity only (a fully-tipped bill).
 */
export function includedGratuityPct(
  billTotal: number,
  includedGratuity: number,
): number {
  const total = Math.max(0, safe(billTotal));
  const included = Math.max(0, Math.min(safe(includedGratuity), total));
  if (included <= 0) return 0;
  const netBase = total - included;
  if (netBase <= 0) return Number.POSITIVE_INFINITY;
  return (included / netBase) * 100;
}

export function bandFor(includedPct: number): TipTierBand {
  if (!(includedPct > 0)) return "standard";
  if (includedPct < PRORATE_LOWER_PCT) return "standard";
  // The pro-rated band is inclusive at BOTH ends: only strictly above 17% drops
  // to the reduced options, and only strictly below 10% keeps the standard ones.
  if (includedPct <= PRORATE_UPPER_PCT) return "prorated";
  return "reduced";
}

// Whole ascending percentages, floored and de-duplicated so the guest never sees
// the same option twice or a nonsensical 0%.
function normalisePcts(pcts: number[]): number[] {
  const out: number[] = [];
  for (const raw of pcts) {
    const pct = Math.max(MIN_ADDITIONAL_TIP_PCT, Math.round(raw));
    if (!out.includes(pct)) out.push(pct);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The tip options to display for a bill.
 *
 * @param billTotal        what the guest is paying (their share), gratuity included
 * @param includedGratuity the service-charge / auto-gratuity part of that share
 */
export function tipTiersFor(
  billTotal: number,
  includedGratuity = 0,
): TipTierPlan {
  const total = Math.max(0, Math.round(safe(billTotal)));
  const included = Math.max(0, Math.min(Math.round(safe(includedGratuity)), total));
  const includedPct = includedGratuityPct(total, included);
  const band = bandFor(includedPct);
  // Percentages are of the pre-gratuity base. A gratuity-only bill has no base,
  // so fall back to the bill total rather than emitting zero-value options.
  const netBase = total - included;
  const base = netBase > 0 ? netBase : total;

  let pcts: number[];
  if (band === "prorated") {
    pcts = normalisePcts(COMBINED_TIP_TARGETS.map((t) => t - includedPct));
  } else if (band === "reduced") {
    pcts = normalisePcts([...REDUCED_TIP_PCTS]);
  } else {
    pcts = normalisePcts([...STANDARD_TIP_PCTS]);
  }

  const finiteIncludedPct = Number.isFinite(includedPct) ? includedPct : 100;

  return {
    band,
    includedPct: Number.isFinite(includedPct)
      ? Math.round(includedPct * 10) / 10
      : Number.POSITIVE_INFINITY,
    includedAmount: included,
    base,
    tiers: pcts.map((pct) => ({
      pct,
      amount: Math.round((base * pct) / 100),
      combinedPct: Math.round((finiteIncludedPct + pct) * 10) / 10,
    })),
  };
}

/** One-line guest explainer for why the options changed. */
export function tipTierNotice(plan: TipTierPlan): string | null {
  if (plan.band === "standard" || plan.includedAmount <= 0) return null;
  const pct = Number.isFinite(plan.includedPct)
    ? `${plan.includedPct}%`
    : "A service charge";
  if (plan.band === "reduced") {
    return `${pct} service charge is already on your bill, so these tip options are lower.`;
  }
  return `${pct} service charge is already on your bill — these add up to about ${plan.tiers[0]?.combinedPct ?? 20}–${plan.tiers[plan.tiers.length - 1]?.combinedPct ?? 25}% in total.`;
}
