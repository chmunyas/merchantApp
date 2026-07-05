---
name: orders-kitchen
description: >-
  Server-authoritative orders + kitchen tickets — create/fire/hold/split/transfer
  an order, table orders, and the new→accepted→preparing→ready→served lifecycle.
  Migrates orders off the localStorage blob. Use for tasks about orders, bills,
  kitchen display (KDS), table service, or taking payment against an order.
---

# Orders & kitchen

Move orders from demo `localStorage` to a real backend so multiple devices + the
kitchen stay in sync, and staff can take payment against an order.

## Today
- Orders live in `localStorage` (`src/lib/realtime.ts` `pesaswap.kitchen.orders`)
  via `submitNewOrder` / `updateKitchenOrderStatus` / `useKitchenOrders`.
- UI: `src/routes/dashboard/orders.tsx` (status board) + `table.$tableId.tsx`
  (customer ordering). **No `orders` table/API** → cross-device clobber.

## Target model (follow the `staff` per-row pattern)
- `orders(id, venue_id, table_id, staff_id, status, total, currency, created_at)`.
- `order_items(id, order_id, name, qty, price, notes)`.
- API `/api/orders`: list (venue+status), create, `PATCH /:id` (status,
  fire/hold), `POST /:id/pay` → generate a pay link (see `payments`/`invoicing`).
- Realtime: keep the BroadcastChannel for UX; the DB is the source of truth.
- **Agent (staff scope):** `open_orders`, `mark_order_ready`, `send_bill(table)`.

## Guardrails
- Venue-pinned + authed for staff writes; link `staff_id` for attribution/tips.
- Status is a fixed lifecycle: `new→accepted→preparing→ready→served|cancelled`.
- Amounts minor units, KES default. See `staff-operations`, `tips`, `payments`.
