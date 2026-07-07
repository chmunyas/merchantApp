// Demand forecasting + smart prep. Pure + unit-testable — the analytical core of
// the demand-forecasting agent. Inputs are pre-aggregated by the API (per
// day-of-week × hour, Nairobi-local); this module turns them into a busy-period
// outlook and a per-item prep plan. DOW is 0=Sunday..6=Saturday (Postgres extract
// + JS Date.getDay() agree).

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayName(dow: number): string {
  return WEEKDAYS[((dow % 7) + 7) % 7];
}

export type HourSlot = {
  dow: number;
  hour: number;
  avgOrders: number;
  avgUnits: number;
};

// The busiest (dow,hour) slots overall, ranked by average order volume.
export function busiestSlots(slots: HourSlot[], topN = 6): HourSlot[] {
  return [...slots]
    .filter((s) => s.avgOrders > 0)
    .sort((a, b) => b.avgOrders - a.avgOrders || a.dow - b.dow || a.hour - b.hour)
    .slice(0, Math.max(0, topN));
}

// For each weekday, the peak hours (>= 70% of that day's busiest hour), so the
// merchant sees "Friday is busy 18:00–20:00".
export function peaksByDay(
  slots: HourSlot[],
): Record<number, { hour: number; avgOrders: number }[]> {
  const byDay = new Map<number, HourSlot[]>();
  for (const s of slots) {
    if (!byDay.has(s.dow)) byDay.set(s.dow, []);
    byDay.get(s.dow)!.push(s);
  }
  const out: Record<number, { hour: number; avgOrders: number }[]> = {};
  for (const [dow, daySlots] of byDay) {
    const max = Math.max(...daySlots.map((s) => s.avgOrders), 0);
    if (max <= 0) {
      out[dow] = [];
      continue;
    }
    out[dow] = daySlots
      .filter((s) => s.avgOrders >= max * 0.7)
      .sort((a, b) => a.hour - b.hour)
      .map((s) => ({ hour: s.hour, avgOrders: Math.round(s.avgOrders * 10) / 10 }));
  }
  return out;
}

export type OutlookDay = {
  date: string;
  dow: number;
  weekday: string;
  predictedOrders: number;
  predictedUnits: number;
};

// Project the next `days` calendar days by mapping each date to its weekday's
// historical hourly averages and summing them.
export function dailyOutlook(
  slots: HourSlot[],
  start: Date,
  days: number,
): OutlookDay[] {
  const totals = new Map<number, { orders: number; units: number }>();
  for (const s of slots) {
    const t = totals.get(s.dow) ?? { orders: 0, units: 0 };
    t.orders += s.avgOrders;
    t.units += s.avgUnits;
    totals.set(s.dow, t);
  }
  const out: OutlookDay[] = [];
  for (let i = 0; i < Math.max(0, days); i += 1) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const dow = d.getUTCDay();
    const t = totals.get(dow) ?? { orders: 0, units: 0 };
    out.push({
      date: d.toISOString().slice(0, 10),
      dow,
      weekday: weekdayName(dow),
      predictedOrders: Math.round(t.orders),
      predictedUnits: Math.round(t.units),
    });
  }
  return out;
}

export type ItemDowStat = {
  name: string;
  avgUnits: number;
  lastUnits: number;
  observations: number;
};

export type PrepLine = {
  name: string;
  recommended: number;
  avgUnits: number;
  lastUnits: number;
  confidence: "high" | "medium" | "low";
};

// Recommended prep quantity per item for a target weekday: blend the historical
// average for that weekday (60%) with the most recent occurrence (40%) to react to
// trend, then add a safety buffer and round up. Confidence follows sample size.
export function prepPlan(items: ItemDowStat[], bufferPct = 0.15): PrepLine[] {
  return items
    .map((it) => {
      const baseline = 0.6 * it.avgUnits + 0.4 * it.lastUnits;
      const recommended = Math.max(0, Math.ceil(baseline * (1 + bufferPct)));
      const confidence: PrepLine["confidence"] =
        it.observations >= 4 ? "high" : it.observations >= 2 ? "medium" : "low";
      return {
        name: it.name,
        recommended,
        avgUnits: Math.round(it.avgUnits * 10) / 10,
        lastUnits: it.lastUnits,
        confidence,
      };
    })
    .sort((a, b) => b.recommended - a.recommended);
}
