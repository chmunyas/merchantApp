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
- `src/routes/pay.tsx` — the customer pay page. Resolves **server-bound** tokens:
  `/pay?i=INV-XXX` (invoices) and `/pay?o=<token>` (QR orders) — the amount always
  comes from the server, never the URL.
- `db/13-payments.sql` — the durable `payments` ledger (amounts in minor units).

## Endpoints
- `POST /api/payments/create` — **public**, rate-limited 10/min. Creates a
  provider payment intent + persists a ledger row (best-effort).
- `GET /api/payments/:id/status` — poll payment status.
- `POST /api/refunds` — **public**, rate-limited; over-refund guarded.
- `POST /api/payments/:id/capture` — **gated**; captures a `capture:false`
  (manual-capture / card pre-auth hold) payment. Simulated in test mode.
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
- **`PAYMENTS_TEST_MODE=1`** simulates a succeeded payment (no provider call) so the
  full journey can be tested end-to-end without live credentials; the ledger is
  still written (loyalty + settlement run). Set `0` + a real `PESASWAP_API_KEY`
  for live payments.
- **Never** log or store a PAN. Keep the SAQ-A posture (see `SECURITY.md`).
- Ledger writes are best-effort (`recordLedger`) — they must never block a payment.

## Common tasks
- **Resolve a short pay link:** `pay.tsx` reads `?i=INV-XXX` (invoices) or
  `?o=<token>` (QR orders → `/api/qr/pay/:token`) → server-authoritative amount →
  drives the pay flow. **Never trust an amount from the URL.**
- **`recordLedger` side effects (on a succeeded payment):** accrues loyalty points
  to the contact by **phone** (unique key), and settles a QR `orders.paid_at` when
  the **cumulative** succeeded payments for that `metadata.order_id` cover the order
  total — so **split / partial payments** don't prematurely close a shared bill.
  Both best-effort. It also tags each row with an **`initiator`** (`human` | `agent`)
  via `resolveInitiator(metadata)` — explicit `metadata.initiator` wins, else an
  `agent_id`/`agentRef` or an A2A `flow_type`/`channel` marks it `agent` (`db/35`).
- **Split-pay is server-authoritative:** `handleCreatePayment` clamps a charge with
  `metadata.order_id` to the order's remaining balance (rejecting a settled bill),
  so a guest can never overpay. Shares are computed in `src/lib/split-bill.ts`; the
  balance is exposed by `GET /api/qr/pay/:token`. QR order amounts are **minor
  units** end-to-end (the QR menu resolver converts whole-KES prices ×100).
- **Saved payment methods are DB-backed** (`customer_payment_methods`, `db/37`):
  `recordLedger` remembers the M-Pesa number on a successful payment, and
  `GET /api/customers/payment-methods?phone=` retrieves it from Postgres (was an
  in-memory Map). `has_saved` stays false for M-Pesa STK (not a one-tap token), so
  the flow is unchanged; the `methods` list is for display/prefill.
- **Add a webhook side effect:** update `handleWebhook` in `payments.ts` and
  persist status changes to the `payments` ledger via `recordLedger`.

## Guidelines
- Validate `amount > 0` before calling the provider.
- Keep idempotency (`Idempotency-Key`) on create + refund.
- When adding ledger fields, migrate in a new `db/NN-*.sql` and keep `recordLedger`
  best-effort (wrapped in try/catch).

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
