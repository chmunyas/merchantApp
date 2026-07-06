---
name: unified-qr
description: >-
  Multi-code unification — one QR that runs the whole counter journey: browse the
  menu, build an order, pay (M-Pesa STK / QR), auto-enroll loyalty and open a
  receipt portal. Use for tasks about scan-to-order, table/venue QR codes, the
  /q/:code page, or "one code = order + pay + enroll + receipt".
---

# Unified QR (multi-code unification)

One printed code replaces the till queue: a customer scans, a branded page opens,
they order, pay on their own phone (M-Pesa STK / QR), earn loyalty and keep a
receipt portal. Every scan is a data point (time, venue, amount) — the QR is a
data-collection point, not just a payment tool. This is the Alipay/WeChat "one
code" insight localized to M-Pesa.

## Key files
- `src/api/qr.ts` — resolve/create codes, log scans, build an order + pay URL.
- `src/routes/q.$code.tsx` — the public, branded, mobile-first unified page.
- `src/routes/dashboard/qr.tsx` — generate + print codes.
- `db/23-qr.sql` — `qr_codes`, `qr_scans`.

## Endpoints
- `GET /api/qr` / `POST /api/qr` — list / create codes (authed, venue-scoped).
- `GET /api/qr/:code` — **public**; resolve → { venue, branding, table?, items };
  logs a `qr_scans` row.
- `POST /api/qr/:code/order` — **public**; creates an order, returns
  { orderId, amount, payUrl }.

## Conventions
- Reuse the existing pay flow (`/pay?…`) — never rebuild payments here.
- Loyalty enrolls through the pay flow (points on success by `customer_phone`).
- Amounts are minor units, KES; authed routes scope by venue.
- The printed code carries only an opaque id; resolve server-side.

## Guidelines
- Keep the public page dependency-light and resilient (works on a cheap phone).
- Log every scan — that behavioural data is the product.
- Prefer per-table codes so a scan knows the seat; a venue code still works.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
