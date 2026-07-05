---
name: payments
description: >-
  Work with PesaSwap payments — Tap & Go checkout, QR scan-to-pay, M-Pesa STK /
  card / Apple-Google Pay, refunds, public pay links, and the payment ledger.
  Use when a task mentions payments, checkout, the /pay page, refunds, payment
  status, webhooks, settlement, or the payments ledger.
---

# Payments

Customer-facing checkout + the payment provider integration. Card data never
touches the server (hosted fields → target PCI SAQ-A); we hold only tokens and
`payment_id`.

## Key files
- `src/api/payments.ts` — `/api/payments/create`, `/api/payments/:id/status`,
  `/api/refunds`, `/api/webhooks/pesaswap`. Threads the worker `env` for the
  Postgres ledger via `recordLedger`.
- `src/lib/pesaswap-payments.ts` — client SDK helpers (`executePayment`,
  `loadHyperLoader`, `buildPaymentMetadata`).
- `src/routes/pay.tsx` — the customer pay page (`/pay?i=INV-XXX` and QR `?tapgo=`).
- `db/13-payments.sql` — the durable `payments` ledger (amounts in minor units).

## Endpoints
- `POST /api/payments/create` — **public**, rate-limited 10/min. Creates a
  provider payment intent + persists a ledger row (best-effort).
- `GET /api/payments/:id/status` — poll payment status.
- `POST /api/refunds` — **public**, rate-limited; over-refund guarded.
- `POST /api/webhooks/pesaswap` — provider webhook.
- `GET /api/invoices/payinfo?number=INV-XXX` — **public** resolver the pay page
  uses to render an amount from a short link (see the invoicing skill).

## Conventions
- Amounts are **minor units** (cents). Currency defaults to `KES`.
- `/api/payments/create` and `/api/refunds` are **public** but rate-limited
  centrally in `server.ts` (see the auth-tenancy skill) — never gate them behind
  `requireAuth`.
- Provider config comes from `PESASWAP_API_KEY` / `PESASWAP_URL` /
  `PESASWAP_WEBHOOK_SECRET` (env), not the DB.
- **Never** log or store a PAN. Keep the SAQ-A posture (see `SECURITY.md`).
- Ledger writes are best-effort (`recordLedger`) — they must never block a payment.

## Common tasks
- **Resolve a short pay link:** `pay.tsx` reads `?i=INV-XXX` → fetches
  `/api/invoices/payinfo` → shows loading/error states → drives the pay flow.
- **Add a webhook side effect:** update `handleWebhook` in `payments.ts` and
  persist status changes to the `payments` ledger via `recordLedger`.

## Guidelines
- Validate `amount > 0` before calling the provider.
- Keep idempotency (`Idempotency-Key`) on create + refund.
- When adding ledger fields, migrate in a new `db/NN-*.sql` and keep `recordLedger`
  best-effort (wrapped in try/catch).
