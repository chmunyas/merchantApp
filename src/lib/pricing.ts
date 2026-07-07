// Dynamic / time-of-day pricing intelligence. Pure + unit-testable. Two engines:
//  1) suggestPrices — quadrant-driven price moves (raise plowhorses/stars,
//     promote puzzles, retire dogs) with an estimated weekly profit impact.
//  2) happyHourWindows — detect quiet trading windows from demand so discounts
//     run when they fill empty seats.
// Prices are whole KES. This is a recommendation layer — it never mutates prices.

import { weekdayName } from "@/lib/forecast";

export type PricingInput = {
  name: string;
  category: string;
  price: number; // whole KES
  margin: number; // whole KES (price - cost)
  unitsSold: number; // over the analysis window
  quadrant: "star" | "plowhorse" | "puzzle" | "dog";
  hasCost: boolean;
};

export type PricingAction = "raise" | "promote" | "remove" | "hold";

export type PricingSuggestion = {
  name: string;
  category: string;
  action: PricingAction;
  currentPrice: number;
  suggestedPrice: number;
  changePct: number; // signed, e.g. 0.1 or -0.15
  weeklyImpact: number; // estimated KES/week profit change if it works
  confidence: "high" | "medium" | "low";
  rationale: string;
};

export type PricingResult = {
  suggestions: PricingSuggestion[];
  totalWeeklyUpside: number;
  counts: Record<PricingAction, number>;
};

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Raise so a rounded price still beats the current one (nearest 10 KES).
function raisedPrice(price: number, pct: number): number {
  const next = roundTo(price * (1 + pct), 10);
  return next > price ? next : price + 10;
}

export function suggestPrices(
  items: PricingInput[],
  windowDays = 30,
): PricingResult {
  const perWeek = (units: number) =>
    windowDays > 0 ? (units * 7) / windowDays : 0;

  const counts: Record<PricingAction, number> = {
    raise: 0,
    promote: 0,
    remove: 0,
    hold: 0,
  };

  const suggestions = items.map((it): PricingSuggestion => {
    const upw = perWeek(it.unitsSold);
    const baseConfidence: PricingSuggestion["confidence"] =
      it.unitsSold >= 20 ? "high" : it.unitsSold >= 5 ? "medium" : "low";
    const confidence = it.hasCost ? baseConfidence : "low";
    const costNote = it.hasCost ? "" : " (add an item cost to sharpen this).";

    let action: PricingAction;
    let suggestedPrice = it.price;
    let rationale = "";

    if (it.quadrant === "plowhorse") {
      action = "raise";
      suggestedPrice = raisedPrice(it.price, 0.1);
      rationale =
        "Popular but thin margin — a ~10% rise adds profit with low churn risk." +
        costNote;
    } else if (it.quadrant === "star") {
      action = "raise";
      suggestedPrice = raisedPrice(it.price, 0.05);
      rationale =
        "Your bestseller — test a small +5% rise; a star can usually carry it." +
        costNote;
    } else if (it.quadrant === "puzzle") {
      action = "promote";
      rationale =
        "High margin, low volume — feature it and run it as a happy-hour special to build trial." +
        costNote;
    } else {
      action = "remove";
      rationale =
        "Low demand and low margin — rework or retire it to cut waste and simplify the menu." +
        costNote;
    }

    const changePct =
      it.price > 0 ? round2((suggestedPrice - it.price) / it.price) : 0;

    let weeklyImpact = 0;
    if (action === "raise") {
      weeklyImpact = Math.round((suggestedPrice - it.price) * upw);
    } else if (action === "promote") {
      // Growth potential: featuring lifts a puzzle's volume ~25% at full margin.
      weeklyImpact = Math.round(0.25 * upw * it.margin);
    }

    counts[action] += 1;
    return {
      name: it.name,
      category: it.category,
      action,
      currentPrice: it.price,
      suggestedPrice,
      changePct,
      weeklyImpact,
      confidence,
      rationale,
    };
  });

  suggestions.sort((a, b) => b.weeklyImpact - a.weeklyImpact);
  const totalWeeklyUpside = suggestions.reduce(
    (s, x) => s + Math.max(0, x.weeklyImpact),
    0,
  );
  return { suggestions, totalWeeklyUpside, counts };
}

export type DemandSlotLite = { dow: number; hour: number; avgOrders: number };

export type HappyHourWindow = {
  dow: number;
  weekday: string;
  startHour: number;
  endHour: number; // exclusive
  avgOrders: number;
  label: string;
};

// Detect contiguous quiet windows (<= 50% of the day's average order rate) inside
// each day's trading hours — the slots where a happy-hour discount fills seats
// rather than discounting demand you already have. Min window length 2 hours.
export function happyHourWindows(
  slots: DemandSlotLite[],
  minHours = 2,
): HappyHourWindow[] {
  const byDay = new Map<number, Map<number, number>>();
  for (const s of slots) {
    if (!byDay.has(s.dow)) byDay.set(s.dow, new Map());
    byDay.get(s.dow)!.set(s.hour, s.avgOrders);
  }

  const windows: HappyHourWindow[] = [];
  for (const [dow, hours] of byDay) {
    const active = [...hours.keys()].filter((h) => (hours.get(h) ?? 0) > 0);
    if (active.length < 3) continue; // too little signal to call quiet vs busy
    const open = Math.min(...active);
    const close = Math.max(...active);
    const span = close - open + 1;
    let total = 0;
    for (let h = open; h <= close; h += 1) total += hours.get(h) ?? 0;
    const mean = total / span;
    const threshold = mean * 0.5;

    let runStart = -1;
    let runSum = 0;
    let runLen = 0;
    const flush = (endExclusive: number) => {
      if (runStart >= 0 && runLen >= minHours) {
        windows.push({
          dow,
          weekday: weekdayName(dow),
          startHour: runStart,
          endHour: endExclusive,
          avgOrders: Math.round((runSum / runLen) * 10) / 10,
          label: `${weekdayName(dow)} ${String(runStart).padStart(2, "0")}:00–${String(
            endExclusive,
          ).padStart(2, "0")}:00`,
        });
      }
      runStart = -1;
      runSum = 0;
      runLen = 0;
    };
    for (let h = open; h <= close; h += 1) {
      const v = hours.get(h) ?? 0;
      if (v <= threshold) {
        if (runStart < 0) runStart = h;
        runSum += v;
        runLen += 1;
      } else {
        flush(h);
      }
    }
    flush(close + 1);
  }

  windows.sort((a, b) => a.dow - b.dow || a.startHour - b.startHour);
  return windows;
}
