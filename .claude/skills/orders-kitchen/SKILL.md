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

## Model (server-authoritative)
- `orders(id, venue_id, table_id, staff_id, status, total, currency, created_at,
  pay_token, pay_expires_at, paid_at, customer_phone, fulfillment_type,
  scheduled_at)` — `db/18-orders.sql` + `db/28-qr-pay-token.sql` (payment binding)
  + `db/43-order-fulfillment.sql` (**pre-order**: `fulfillment_type`
  dine_in|collection|delivery, default dine_in; `scheduled_at` NULL = ASAP).
  Helpers in `src/lib/fulfillment.ts` (`normalizeFulfillment`, `parseScheduledAt`).
- `order_items(id, order_id, name, qty, price, notes)`.
- API `/api/orders`: list (venue+status), create, `PATCH /:id` (status,
  `pickupAt`, `fulfilment`). Transitioning to `ready` sends a one-shot "order
  ready for collection" message to `customer_phone` (best-effort, via the
  omnichannel adapter). Click-&-collect fields + `db/34`. The
  unified-QR flow (`POST /api/qr/:code/order`) also creates an order + a
  **server-bound pay token** (`/pay?o=<token>`).
- **Take payment against ANY order** (kitchen/dashboard-created, not just QR
  scans): `POST /api/orders/:id/pay-link` (gated) ensures the order carries a fresh
  server-bound pay token + returns the split-aware `/pay?o=<token>` link (amount =
  outstanding balance; 409 if already paid). Surfaced as a **"Request payment"**
  button on each Kitchen Display card → OmniShare (WhatsApp/Telegram/SMS). Settles
  the order via `recordLedger` when cumulative payments cover the total.
- **Payment:** an order is charged via the pay flow; `recordLedger` stamps
  `orders.paid_at` on success (one-time-use). See `payments` + `unified-qr`.
- Realtime: keep the BroadcastChannel for UX; the DB is the source of truth.
- **Agent (staff scope):** `open_orders`, `mark_order_ready`, `send_bill(table)`.
- **Customer notifications (fulfillment-aware):** on a REAL status change to
  `accepted` (acknowledged) / `preparing` (processed) / `ready`, `PATCH
  /api/orders/:id` messages the order's customer on their channel — consent-checked
  (`isSuppressed`) + logged to the conversation timeline — with eat-in vs
  collection wording and the scheduled time. Copy is pure in
  `src/lib/order-notify.ts` (`orderStatusMessage`); change-detection makes it
  idempotent. A customer can also ask "where's my order?" — the agent's
  `get_order_status` tool answers via `orderStatusReply` (venue + phone scoped).

## Guardrails
- Venue-pinned + authed for staff writes; link `staff_id` for attribution/tips.
- Status is a fixed lifecycle: `new→accepted→preparing→ready→served|cancelled`.
- Amounts minor units, KES default. See `staff-operations`, `tips`, `payments`.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
