---
name: revenue-optimisation
description: >-
  Menu engineering + pricing intelligence — classify items star/plowhorse/puzzle/
  dog by popularity × profit and recommend price, placement, bundle and upsell
  moves. Use for tasks about menu engineering, item profitability, pricing
  strategy, contribution margin, or "which items make money".
---

# Revenue optimisation (menu engineering)

Turns live sales + inventory cost into profit-growth actions. Every menu item is
plotted on the classic Kasavana-Smith matrix — popularity (menu mix vs the 70%
threshold) × profitability (unit contribution margin vs the weighted average) —
into **star / plowhorse / puzzle / dog**, each with a concrete recommendation.
This is the analytical brain of the revenue-optimisation agent.

## Key files

- `src/lib/menu-engineering.ts` — pure, unit-tested core: `classifyMenu` (quadrants,
  margins, menu-mix, thresholds, per-item recommendation), `buildHeadline`,
  `buildAdvicePrompt` (AI narrative prompt).
- `src/api/menu.ts` — `GET /api/menu/engineering` (gated, manager+).
- `src/lib/venue-stats.ts` — shared `menuProfitStats` (price/cost/units) reused by
  the pricing surface.
- `src/routes/dashboard/menu.tsx` — the "Engineering" tab (counts, headline, advice,
  per-item table with quadrant badges).
- Reuses existing tables — **no migration**: `menu_items` (price, whole KES),
  `order_items`/`orders` (units sold), `inventory_items` (unit cost, minor units).

## Endpoint

- `GET /api/menu/engineering?from=&to=` — **gated** (`requireAuth` + `roleAtLeast
manager`). Returns `{ items:[{name, quadrant, price, cost, margin, marginPct,
unitsSold, menuMixPct, recommendation, hasCost}], counts, totalUnits,
avgMarginPerUnit, popularityThreshold, headline, advice, aiAdvice }`.

## Conventions

- **Units:** `menu_items.price` + the derived `cost`/`margin` are **whole KES**;
  `inventory_items.cost` is **minor units** → divide by 100 when joining. Popularity
  uses `order_items.qty` (unit-agnostic).
- Cost is matched per item by `inventory_items.menu_item_id` first, else by lower(name)
  — the same name-matching COGS + lost-basket already use. `hasCost=false` flags items
  with no linked cost (their margin = price and should be caveated).
- Sales exclude `orders.status IN ('cancelled','void')`; default window is 30 days.
- Popularity is the 70% rule: `menuMix >= (1/N) * 0.7`. Profitability compares each
  item's per-unit contribution margin to the **weighted** average CM per unit.
- The AI narrative (`aiChat` + `buildAdvicePrompt`) is best-effort and degrades to the
  deterministic `headline`; `aiAdvice` says which was returned.

## Guidelines

- Keep the classification math in the pure lib (testable); DB/AI work stays in the route.
- Never expose costs/margins to unauthenticated or sub-manager roles — this is
  owner/manager intelligence.
- Recommendations are per-quadrant and deterministic: raise price on plowhorses,
  promote/upsell puzzles, protect + test-price stars, rework/retire dogs.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: revenue-optimisation -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Reproducible menu-engineering classifications and contribution-margin recommendations using traceable volume, price, cost, period, timezone, tax, channel, confidence, and data-freshness inputs.
- Manager preview and approval, explainable impact, experiment and rollback behavior, role controls, and a safe handoff that never silently changes a live price or menu.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
