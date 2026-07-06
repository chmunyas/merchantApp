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

// Perks shown in the customer portal to motivate climbing the ladder. Sensible
// defaults — a venue can later override these per tier.
export const TIER_BENEFITS: Record<LoyaltyTier, string[]> = {
  Bronze: ["1 point per KES 10 spent", "A birthday treat"],
  Silver: ["Everything in Bronze", "5% back in points", "Priority table booking"],
  Gold: [
    "Everything in Silver",
    "10% back in points",
    "Free delivery",
    "Skip-the-queue ordering",
  ],
  Platinum: [
    "Everything in Gold",
    "15% back in points",
    "A dedicated host",
    "Invites to exclusive events",
  ],
};

export function tierBenefits(points: number): {
  tier: LoyaltyTier;
  current: string[];
  next: { tier: LoyaltyTier; benefits: string[] } | null;
} {
  const prog = tierProgress(points);
  return {
    tier: prog.tier,
    current: TIER_BENEFITS[prog.tier],
    next: prog.nextTier
      ? { tier: prog.nextTier, benefits: TIER_BENEFITS[prog.nextTier] }
      : null,
  };
}

// Points expire after a period of inactivity (measured from last_visit). Surfaced
// as a nudge in the portal when inside the warning window, to drive a return visit.
export const POINTS_EXPIRY_MONTHS = 12;
const EXPIRY_WARN_DAYS = 60;

export function pointsExpiry(
  lastVisit: string | null | undefined,
  points: number,
): { expiresAt: string | null; atRisk: boolean; daysLeft: number | null } {
  if (!lastVisit || points <= 0) {
    return { expiresAt: null, atRisk: false, daysLeft: null };
  }
  const last = new Date(lastVisit);
  if (Number.isNaN(last.getTime())) {
    return { expiresAt: null, atRisk: false, daysLeft: null };
  }
  const expires = new Date(last);
  expires.setMonth(expires.getMonth() + POINTS_EXPIRY_MONTHS);
  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / 86_400_000);
  return {
    expiresAt: expires.toISOString().slice(0, 10),
    atRisk: daysLeft <= EXPIRY_WARN_DAYS,
    daysLeft,
  };
}
