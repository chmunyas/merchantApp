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

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
