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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: auto-reorder -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Explainable stockout prediction and supplier-grouped draft purchase orders based on server-authoritative stock, lead time, consumption, pack size, minimum order, and freshness.
- Manager approval, override reasons, duplicate prevention, audit history, degraded-data warnings, and a safe handoff from recommendation to procurement.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
