// Points-based loyalty tier ladder. Points accrue on payment (≈1 point per KES 10
// spent). Shared so the customer portal + any future tier logic agree on the same
// thresholds and "points to next tier" maths.
export type LoyaltyTier = "Bronze" | "Silver" | "Gold" | "Platinum";

export const TIER_LADDER: Array<{ tier: LoyaltyTier; threshold: number }> = [
  { tier: "Bronze", threshold: 0 },
  { tier: "Silver", threshold: 500 },
  { tier: "Gold", threshold: 2000 },
  { tier: "Platinum", threshold: 5000 },
];

export type TierProgress = {
  tier: LoyaltyTier;
  nextTier: LoyaltyTier | null;
  pointsToNext: number;
  progressPct: number;
  atTop: boolean;
};

// Given a points balance, return the current tier, the next tier, how many points
// remain to reach it, and the % filled within the current band (for a progress
// bar). At the top tier, progress is 100% and nextTier is null.
export function tierProgress(points: number): TierProgress {
  const p = Math.max(0, Math.floor(Number(points) || 0));
  let idx = 0;
  for (let i = 0; i < TIER_LADDER.length; i += 1) {
    if (p >= TIER_LADDER[i].threshold) idx = i;
  }
  const current = TIER_LADDER[idx];
  const next = TIER_LADDER[idx + 1] ?? null;
  if (!next) {
    return {
      tier: current.tier,
      nextTier: null,
      pointsToNext: 0,
      progressPct: 100,
      atTop: true,
    };
  }
  const band = next.threshold - current.threshold;
  const within = p - current.threshold;
  const progressPct = band > 0 ? Math.min(100, Math.round((within / band) * 100)) : 0;
  return {
    tier: current.tier,
    nextTier: next.tier,
    pointsToNext: Math.max(0, next.threshold - p),
    progressPct,
    atTop: false,
  };
}
