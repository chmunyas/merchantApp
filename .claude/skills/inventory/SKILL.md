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

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
