---
name: inventory
description: >-
  Stock control for the retail/supermarket vertical — inventory items, stock
  levels, low-stock alerts, COGS, adjustments and reorder. Use when a task
  mentions inventory, stock, restock quantities, reorder levels, COGS/margins,
  or "what's running low".
---

# Inventory

Server-authoritative stock so a shop (not just a restaurant) can run on the app.
Distinct from menu availability (86/restock is a boolean) — this tracks real
quantities, cost (COGS) and reorder points. Unlocks the retail/supermarket
vertical from the platform vision.

## Key files

- `src/api/inventory.ts` — CRUD + `GET /api/inventory/low` + `POST /:id/adjust`.
- `src/routes/dashboard/inventory.tsx` — stock list, low-stock badges, adjust.
- `db/24-inventory.sql` — `inventory_items`, `inventory_movements`.

## Endpoints

- `GET /api/inventory` / `GET /api/inventory/low` — list / below reorder level.
- `POST /api/inventory` · `PATCH /api/inventory/:id` · `DELETE /api/inventory/:id`.
- `POST /api/inventory/:id/adjust` — `{ delta, reason }`, logs a movement.

## Conventions

- All routes authed + venue-scoped (`requireAuth` + `venueFromPayload`).
- `cost` (COGS per unit) is minor units, KES; `stock`/`reorder_level` are numeric.
- Every stock change writes an `inventory_movements` audit row.
- Optional `menu_item_id` links a stock line to a menu item.

## Guidelines

- Surface low stock loudly (badge + a copilot `stock_report` tool).
- Keep adjustments append-only (movements) — never silently overwrite stock.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: inventory -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Server-authoritative, multi-store items, SKU/barcode lookup, stock movements, counts, low-stock thresholds, cost access, suppliers, purchase orders, receiving, waste, transfer, and adjustments.
- Append-only movement history, concurrency and idempotency, negative-stock policy, approval and reason controls, valuation traceability, and reconciliation to sales and accounting.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
