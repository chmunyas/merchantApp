// Customer RFM (Recency / Frequency / Monetary) segmentation, churn risk and a
// simple LTV projection. Pure + unit-testable — the analytical core of the
// customer-value / win-back agent. Inputs are pre-aggregated per customer by the
// API (from the payments ledger); monetary is whole KES.

export type CustomerStat = {
  ref: string; // customer phone (the loyalty key)
  name: string;
  tier: string;
  recencyDays: number; // days since last purchase
  frequency: number; // number of purchases
  monetary: number; // total spent, whole KES
  tenureDays: number; // days since first purchase
};

export type Segment =
  | "Champions"
  | "Loyal"
  | "Promising"
  | "At risk"
  | "Lost"
  | "Needs attention";

export type ScoredCustomer = CustomerStat & {
  r: number; // 1..5 (5 = most recent)
  f: number; // 1..5 (5 = most frequent)
  m: number; // 1..5 (5 = highest spend)
  segment: Segment;
  churnRisk: "high" | "medium" | "low";
  avgOrderValue: number;
  predictedAnnualValue: number;
};

export type RfmResult = {
  totalCustomers: number;
  totalMonetary: number;
  segments: Record<Segment, number>;
  customers: ScoredCustomer[];
  atRisk: ScoredCustomer[]; // win-back targets: churning, highest value first
};

const SEGMENTS: Segment[] = [
  "Champions",
  "Loyal",
  "Promising",
  "At risk",
  "Lost",
  "Needs attention",
];

// Percentile-rank each value into 1..5. `higherIsBetter=false` inverts the axis
// (used for recency, where fewer days is better).
function scoreAxis(values: number[], higherIsBetter: boolean): number[] {
  const n = values.length || 1;
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const rank = sorted.filter((x) => x <= v).length / n; // (0..1]
    let score = Math.ceil(rank * 5);
    if (score < 1) score = 1;
    if (score > 5) score = 5;
    return higherIsBetter ? score : 6 - score;
  });
}

function segmentOf(r: number, f: number): Segment {
  if (r >= 4 && f >= 4) return "Champions";
  if (f >= 4) return "Loyal";
  if (r >= 4 && f <= 2) return "Promising";
  if (r <= 2 && f >= 3) return "At risk";
  if (r <= 2 && f <= 2) return "Lost";
  return "Needs attention";
}

function churnRiskOf(stat: CustomerStat): "high" | "medium" | "low" {
  const avgGap =
    stat.frequency > 1 ? stat.tenureDays / (stat.frequency - 1) : 30;
  const overdue = stat.recencyDays > 2 * avgGap;
  if (stat.frequency >= 2 && overdue && stat.recencyDays > 30) return "high";
  if (stat.recencyDays > 60) return "medium";
  return "low";
}

export function scoreCustomers(list: CustomerStat[]): RfmResult {
  const rScores = scoreAxis(
    list.map((c) => c.recencyDays),
    false,
  );
  const fScores = scoreAxis(
    list.map((c) => c.frequency),
    true,
  );
  const mScores = scoreAxis(
    list.map((c) => c.monetary),
    true,
  );

  const segments: Record<Segment, number> = {
    Champions: 0,
    Loyal: 0,
    Promising: 0,
    "At risk": 0,
    Lost: 0,
    "Needs attention": 0,
  };

  const customers: ScoredCustomer[] = list.map((stat, i) => {
    const r = rScores[i];
    const f = fScores[i];
    const m = mScores[i];
    const segment = segmentOf(r, f);
    segments[segment] += 1;
    const avgOrderValue =
      stat.frequency > 0 ? Math.round(stat.monetary / stat.frequency) : 0;
    // LTV projection needs an established cadence: only annualise once a customer
    // has repeated (>=2 purchases), and floor tenure at 30 days so a brand-new
    // customer's tiny denominator can't explode the estimate.
    let predictedAnnualValue = avgOrderValue; // unproven: assume ~1 purchase/year
    if (stat.frequency >= 2) {
      const effectiveTenure = Math.max(stat.tenureDays, 30);
      const purchasesPerYear = (stat.frequency / effectiveTenure) * 365;
      predictedAnnualValue = Math.round(avgOrderValue * purchasesPerYear);
    }
    return {
      ...stat,
      r,
      f,
      m,
      segment,
      churnRisk: churnRiskOf(stat),
      avgOrderValue,
      predictedAnnualValue,
    };
  });

  customers.sort((a, b) => b.monetary - a.monetary);

  // Win-back targets: customers who are slipping (churn risk), highest value first
  // — spend the retention effort where the money is.
  const atRisk = customers
    .filter((c) => c.churnRisk !== "low")
    .sort(
      (a, b) =>
        b.monetary - a.monetary || a.recencyDays - b.recencyDays,
    )
    .slice(0, 25);

  return {
    totalCustomers: list.length,
    totalMonetary: list.reduce((s, c) => s + c.monetary, 0),
    segments,
    customers,
    atRisk,
  };
}

export { SEGMENTS };
