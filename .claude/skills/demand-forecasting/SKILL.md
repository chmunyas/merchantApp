---
name: demand-forecasting
description: >-
  Demand forecasting + smart prep — predict busy periods and recommended prep
  quantities from order history. Use for tasks about forecasting, busy periods,
  prep planning, staffing/demand patterns, or "how much should I prepare".
---

# Demand forecasting & smart prep

Turns order history into an operational plan: when the venue will be busy and how
much of each item to prep. Demand is bucketed by **Nairobi-local** day-of-week ×
hour so peaks reflect real trading hours, and per-item prep quantities blend the
weekday average with the most recent occurrence. This is the core of the
demand-forecasting agent.

## Key files
- `src/lib/forecast.ts` — pure, unit-tested core: `busiestSlots`, `peaksByDay`,
  `dailyOutlook`, `prepPlan`, `weekdayName`.
- `src/api/forecast.ts` — `GET /api/forecast` (gated manager+); registered in
  `src/server.ts` as `handleForecastRoute`.
- `src/routes/dashboard/forecast.tsx` — manager-gated "Forecast" page (busiest
  windows, next-N-days outlook bars, smart-prep table with a date picker).
- Reuses existing tables — **no migration**: `orders` (created_at, status) +
  `order_items` (name, qty).

## Endpoint
- `GET /api/forecast?date=YYYY-MM-DD&days=7` — **gated** (`requireAuth` +
  `roleAtLeast manager`). Returns `{ timezone, windowDays, demand:{ busiest[],
  peaksByDay, outlook[] }, prep:{ date, weekday, bufferPct, lines[] } }`. `date`
  defaults to tomorrow; `days` (1–14) sizes the outlook.

## Conventions
- **Timezone:** bucket by `created_at AT TIME ZONE 'Africa/Nairobi'` (the app's KES
  market, no DST). Keep the timezone a **literal** in SQL — parameterising
  `AT TIME ZONE $1` breaks Postgres type inference (500s).
- DOW is 0=Sunday..6=Saturday (Postgres `extract(dow)` and JS `Date.getDay()` agree).
- Sales exclude `orders.status IN ('cancelled','void')`. Hourly history = 56 days;
  per-item prep history = 84 days.
- Prep baseline = `0.6*weekdayAvg + 0.4*lastOccurrence`, ×(1+buffer), rounded up.
  Confidence: ≥4 observations high, 2–3 medium, else low.
- Averages divide by the count of **distinct dates observed**, not raw rows.

## Guidelines
- Keep the forecasting math in the pure lib (testable); SQL aggregation stays in the
  route. The route feeds pre-aggregated `HourSlot[]` / `ItemDowStat[]` to the lib.
- Gate to manager+ — it reveals trading patterns and volumes.
- Match items by name (as COGS / menu-engineering do); don't assume a menu link.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
