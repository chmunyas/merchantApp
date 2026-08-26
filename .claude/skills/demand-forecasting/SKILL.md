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
- `src/lib/venue-stats.ts` — shared `demandSlots` (Nairobi-local dow×hour) reused by
  the pricing (happy-hour) surface.
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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: demand-forecasting -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Reproducible forecasts and prep recommendations using server-authoritative demand, item mappings, trading calendar, timezone, horizon, version, freshness, confidence, and exception inputs.
- Manager review, override reasons, backtesting, degraded-data warnings, and a safe operational handoff without silently changing stock, labour, price, or orders.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
