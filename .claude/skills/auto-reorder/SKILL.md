---
name: auto-reorder
description: >-
  Inventory auto-reorder — predict stockouts from consumption velocity and draft
  supplier-grouped purchase orders. Use for tasks about reordering, stockouts,
  purchase orders, days-of-stock, restock quantities, or "what do I need to buy".
---

# Inventory auto-reorder

Turns current stock + recent consumption into a stockout forecast and a
supplier-grouped draft purchase order: what's about to run out, how much to buy,
and from whom. It **recommends** — it never writes stock.

## Key files
- `src/lib/reorder.ts` — pure, unit-tested core: `planReorder` (velocity →
  days-left, status, top-up quantity, supplier-grouped draft POs).
- `src/api/inventory.ts` — `GET /api/inventory/reorder` inside `handleInventoryRoute`
  (gated manager+).
- `src/routes/dashboard/reorder.tsx` — manager-gated "Reorder" page (status
  summary, draft POs by supplier, days-of-cover table).
- Reuses existing tables — **no migration**: `inventory_items` +
  `inventory_movements` (negative deltas = consumption).

## Endpoint
- `GET /api/inventory/reorder` — **gated** (`requireAuth` + `roleAtLeast manager`).
  Returns `{ currency, leadTimeDays, coverDays, lines[], toOrder[], bySupplier[],
  totalReorderCost, counts }`. Each line: `{ stock, dailyVelocity, daysLeft,
  status, suggestedQty, cost, lineCost, reason }`.

## Conventions
- **Velocity = consumption**, from `inventory_movements` where `delta < 0` over the
  last 30 days (the authoritative stock-out log written by `/api/inventory/:id/adjust`).
- `inventory_items.cost` is **minor units** (cents) — divide by 100 for whole-KES
  line costs (same convention COGS + menu engineering use).
- `daysLeft = stock / dailyVelocity` (null when no consumption). Status: critical
  (out, or days-left ≤ lead time), low (days-left ≤ lead+cover, or at/below the
  manual `reorder_level`), overstocked (> 3× cover), else ok.
- Top-up target = `max(velocity × (lead+cover), reorder_level)`; `suggestedQty =
  ceil(target − stock)`. Defaults: window 30d, lead 3d, cover 14d.
- Draft POs group `toOrder` (qty > 0) by supplier (null → "Unassigned"), critical
  first, then soonest to run out.

## Guidelines
- Keep the planning math in the pure lib (testable); the SQL velocity aggregation
  stays in the route.
- Gate to manager+ — it exposes costs + supplier spend.
- Never mutate stock here — this surface drafts orders; stock changes go through the
  inventory adjust endpoint.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
