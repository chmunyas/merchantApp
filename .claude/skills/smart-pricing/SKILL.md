---
name: smart-pricing
description: >-
  Dynamic / time-of-day pricing intelligence — quadrant-driven price moves (raise
  plowhorses/stars, promote puzzles, retire dogs) with weekly-impact estimates,
  plus happy-hour window detection. Use for tasks about pricing strategy, price
  changes, happy hours, discounts, or "what should I charge / when should I
  discount".
---

# Smart pricing (dynamic / time-of-day)

Combines margins (menu engineering) with demand (forecasting) into a pricing
playbook: which items to re-price and when to run discounts. It is a
**recommendation layer** — it never mutates menu prices; the merchant applies
changes in the menu editor.

## Key files
- `src/lib/pricing.ts` — pure, unit-tested core: `suggestPrices` (quadrant →
  raise/promote/remove + estimated weekly profit impact) and `happyHourWindows`
  (contiguous quiet windows inside trading hours).
- `src/lib/venue-stats.ts` — shared `menuProfitStats` + `demandSlots` (also used by
  menu engineering + forecasting) so all three read the same numbers.
- `src/api/pricing.ts` — `GET /api/pricing` (gated manager+); registered in
  `src/server.ts` as `handlePricingRoute`.
- `src/routes/dashboard/pricing.tsx` — manager-gated "Pricing" page (upside
  summary, happy-hour windows, price-moves table, retire list).
- Reuses existing tables — **no migration**.

## Endpoint
- `GET /api/pricing?from=&to=` — **gated** (`requireAuth` + `roleAtLeast manager`).
  Returns `{ currency, windowDays, pricing:{ suggestions[], totalWeeklyUpside,
  counts }, happyHours[] }`. Each suggestion: `{ action, currentPrice,
  suggestedPrice, changePct, weeklyImpact, confidence, rationale }`.

## Conventions
- Prices are **whole KES**; suggestions round to the nearest 10 and never lower a
  "raise" below the current price.
- Rules: plowhorse → **raise ~10%**, star → **raise ~5%** (test), puzzle →
  **promote** (feature + happy-hour, price held), dog → **remove/rework**.
- `weeklyImpact` = for a raise, `Δprice × units/week` (volume assumed to hold); for
  a promote, growth potential `0.25 × units/week × margin`. `totalWeeklyUpside`
  sums positive impacts.
- Confidence follows sales sample; drops to `low` (with a note) when the item has no
  linked inventory cost, since its margin is then just its price.
- Happy hours = contiguous hours at ≤ 50% of the day's average order rate, min 2h,
  inside the day's trading window (Nairobi-local, via `demandSlots`).

## Guidelines
- Keep the math in the pure lib (testable); DB reads go through `venue-stats`.
- Never write prices from here — this surface only recommends.
- Gate to manager+; it exposes margins and trading patterns.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
