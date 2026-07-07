// Menu engineering (Kasavana-Smith): classify every menu item by popularity
// (menu-mix vs the 70% threshold) and profitability (unit contribution margin vs
// the weighted-average CM) into star / plowhorse / puzzle / dog, and attach a
// concrete pricing/merchandising recommendation. Pure + unit-testable — this is
// the analytical core of the revenue-optimisation agent.

export type MenuStat = {
  name: string;
  category: string;
  price: number; // whole KES — selling price
  cost: number; // whole KES — unit cost (0 when unknown)
  unitsSold: number;
  hasCost?: boolean;
};

export type Quadrant = "star" | "plowhorse" | "puzzle" | "dog";

export type ClassifiedItem = {
  name: string;
  category: string;
  price: number;
  cost: number;
  hasCost: boolean;
  unitsSold: number;
  margin: number; // price - cost (whole KES)
  marginPct: number; // margin / price (0..1)
  menuMixPct: number; // unitsSold / totalUnits (0..1)
  revenue: number; // price * unitsSold
  contribution: number; // margin * unitsSold
  popularity: "high" | "low";
  profitability: "high" | "low";
  quadrant: Quadrant;
  recommendation: string;
};

export type MenuEngineering = {
  currency: string;
  itemCount: number;
  totalUnits: number;
  totalRevenue: number;
  totalContribution: number;
  avgMarginPerUnit: number;
  popularityThreshold: number;
  counts: Record<Quadrant, number>;
  headline: string;
  items: ClassifiedItem[];
};

const QUADRANT_LABELS: Record<Quadrant, string> = {
  star: "Star",
  plowhorse: "Plowhorse",
  puzzle: "Puzzle",
  dog: "Dog",
};

function baseRecommendation(q: Quadrant): string {
  switch (q) {
    case "star":
      return "Popular & profitable. Keep it prominent, protect quality, and test a small price rise.";
    case "plowhorse":
      return "Popular but low margin. Nudge the price up, trim portion cost, or bundle it to lift the check.";
    case "puzzle":
      return "Profitable but under-sold. Reposition or rename it, feature it on the menu, and upsell at checkout.";
    case "dog":
      return "Low demand & low margin. Rework the recipe, re-price, or retire it.";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function classifyMenu(
  stats: MenuStat[],
  currency = "KES",
): MenuEngineering {
  const n = stats.length;
  const totalUnits = stats.reduce((s, i) => s + Math.max(0, i.unitsSold), 0);

  const margins = stats.map((i) => i.price - i.cost);
  const totalContribution = stats.reduce(
    (s, i, idx) => s + margins[idx] * Math.max(0, i.unitsSold),
    0,
  );
  const totalRevenue = stats.reduce(
    (s, i) => s + i.price * Math.max(0, i.unitsSold),
    0,
  );

  // Weighted average contribution margin per unit sold; when nothing has sold,
  // fall back to the simple average margin so the profitability axis still splits.
  const avgMarginPerUnit =
    totalUnits > 0
      ? totalContribution / totalUnits
      : n > 0
        ? margins.reduce((s, m) => s + m, 0) / n
        : 0;

  // The 70% rule: an item is "popular" if its menu mix beats 70% of a fair share.
  const popularityThreshold = n > 0 ? (1 / n) * 0.7 : 0;

  const counts: Record<Quadrant, number> = {
    star: 0,
    plowhorse: 0,
    puzzle: 0,
    dog: 0,
  };

  const items: ClassifiedItem[] = stats.map((stat, idx) => {
    const margin = margins[idx];
    const units = Math.max(0, stat.unitsSold);
    const menuMixPct = totalUnits > 0 ? units / totalUnits : 0;
    const popular = totalUnits > 0 && menuMixPct >= popularityThreshold;
    const profitable = margin >= avgMarginPerUnit;
    const quadrant: Quadrant = popular
      ? profitable
        ? "star"
        : "plowhorse"
      : profitable
        ? "puzzle"
        : "dog";
    counts[quadrant] += 1;
    const hasCost = stat.hasCost ?? stat.cost > 0;
    const rec = hasCost
      ? baseRecommendation(quadrant)
      : `${baseRecommendation(quadrant)} (Add a unit cost for a true margin.)`;
    return {
      name: stat.name,
      category: stat.category,
      price: stat.price,
      cost: stat.cost,
      hasCost,
      unitsSold: units,
      margin,
      marginPct: stat.price > 0 ? round2(margin / stat.price) : 0,
      menuMixPct: round2(menuMixPct),
      revenue: stat.price * units,
      contribution: margin * units,
      popularity: popular ? "high" : "low",
      profitability: profitable ? "high" : "low",
      quadrant,
      recommendation: rec,
    };
  });

  // Rank: stars first, then by contribution — the merchant sees the money-makers up top.
  const order: Record<Quadrant, number> = {
    star: 0,
    plowhorse: 1,
    puzzle: 2,
    dog: 3,
  };
  items.sort(
    (a, b) =>
      order[a.quadrant] - order[b.quadrant] || b.contribution - a.contribution,
  );

  return {
    currency,
    itemCount: n,
    totalUnits,
    totalRevenue,
    totalContribution,
    avgMarginPerUnit: round2(avgMarginPerUnit),
    popularityThreshold: round2(popularityThreshold),
    counts,
    headline: buildHeadline(counts),
    items,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function buildHeadline(counts: Record<Quadrant, number>): string {
  const parts = (Object.keys(QUADRANT_LABELS) as Quadrant[])
    .filter((q) => counts[q] > 0)
    .map((q) => plural(counts[q], QUADRANT_LABELS[q].toLowerCase()));
  if (parts.length === 0) return "No menu items to analyse yet.";
  const actions: string[] = [];
  if (counts.plowhorse > 0) actions.push("raise prices on plowhorses");
  if (counts.puzzle > 0) actions.push("promote puzzles");
  if (counts.dog > 0) actions.push("rework or retire dogs");
  const tail = actions.length ? ` — ${actions.join(", ")}.` : ".";
  return `${parts.join(", ")}${tail}`;
}

// Build a chat prompt so an AI provider can turn the classification into a short
// merchant-facing narrative. The endpoint degrades to `headline` if no provider.
export function buildAdvicePrompt(
  engineering: MenuEngineering,
): { role: "system" | "user"; content: string }[] {
  const rows = engineering.items.map((i) => ({
    name: i.name,
    quadrant: i.quadrant,
    units: i.unitsSold,
    price: i.price,
    margin: i.margin,
  }));
  return [
    {
      role: "system",
      content:
        "You are a restaurant revenue-optimisation advisor. Given a menu-engineering " +
        "classification (star/plowhorse/puzzle/dog), write 3-5 short, specific, actionable " +
        "bullet points to grow profit — pricing moves, menu placement, bundling and upsells. " +
        "Be concise and concrete. No preamble, just the bullets.",
    },
    {
      role: "user",
      content: `Currency: ${engineering.currency}\nItems:\n${JSON.stringify(rows)}`,
    },
  ];
}
