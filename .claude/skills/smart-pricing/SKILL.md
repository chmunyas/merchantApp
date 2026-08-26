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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: smart-pricing -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Explainable price and promotion recommendations with effective windows, timezone, channel, item eligibility, tax, margin floor, demand evidence, estimated impact, confidence, and versioned inputs.
- Manager approval, conflict detection, preview, publish, POS/channel propagation, rollback, customer price consistency, audit, and safeguards against discriminatory or unlawful pricing.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
