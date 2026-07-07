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
  `/pay?i=INV-XXX` (invoices), `/pay?o=<token>` (QR orders), and `/pay?r=<token>`
  (pay-links) — the amount always comes from the server, never the URL.
- `src/lib/pay-links.ts` — `createPayLink`, `resolvePayLink`, `markPayLinkPaid`.
  Tokens resolve to `/pay?r=<token>` with server-bound amount + merchant branding.
- `src/lib/links.ts` — `payRequestLink(base, token)` → `${base}/pay?r=<token>`.
- `db/13-payments.sql` — the durable `payments` ledger (amounts in minor units).
- `db/39-pay-links.sql` — `pay_links` table: `token`, `venue_id`, minor-unit
  `amount`, `currency`, `description`, `kind` (`request`/`tapgo`/`deposit`/
  `split`/`booking`), `reference`, customer fields, status, creator/payment ids,
  timestamps; indexed by venue/date, venue/status, and customer phone.

## Endpoints
- `POST /api/payments/create` — **public**, rate-limited 10/min. Creates a
  provider payment intent + persists a ledger row (best-effort).
- `GET /api/payments/:id/status` — poll payment status.
- `POST /api/refunds` — **public**, rate-limited; over-refund guarded.
- `POST /api/payments/:id/capture` — **gated**; captures a `capture:false`
  (manual-capture / card pre-auth hold) payment. Simulated in test mode.
- `POST /api/webhooks/pesaswap` — provider webhook. Verifies HMAC-SHA512 in
  `x-webhook-signature-512` (fallback `-256`) over the raw body; **fail-closed**.
  On `payment_succeeded`/`payment_captured` (Hyperswitch envelope `{ event_type,
  content:{ object } }`) it confirms the ledger (`recordLedger`, idempotent) and
  **persists tokenised card/wallet saved methods** (SAQ-A: only the token id, brand,
  last4) to `customer_payment_methods`.
- `GET /api/payment-methods` — **gated (manager+)** merchant view: all saved
  customer methods joined to contacts (name/tier) + M-Pesa/card/wallet counts.
  Renders at `/dashboard/payment-methods`.
- `GET /api/payments/list` — **gated (manager+)** DB-backed ledger: every real
  attempt (any status) for the venue, with the M-Pesa receipt (`provider_ref` =
  `connector_transaction_id`, e.g. `UG75TAWWYH`), decline reason, tip + initiator.
  Powers the "Live payments" panel on `/dashboard/payments` (localStorage demo
  data alone never showed real sales).
- `POST /api/payments/:id/retry` — **gated (manager+)** re-request: re-fires a
  fresh STK for a failed/processing payment from its stored phone + amount (409 if
  already succeeded). Replays through `handleCreatePayment`, so a split re-clamps
  to the remaining balance.
- `GET /api/invoices/payinfo?number=INV-XXX` — **public** resolver the pay page
  uses to render an amount from a short link (see the invoicing skill).
- `POST /api/pay-links` — **gated staff+**; mints a pay-link from minor-unit
  `amount` or whole-KES `amountKes`.
- `GET /api/pay-links/:token` — **public** resolver for `/pay?r=<token>`.
- `GET /api/pay-links` — **gated**; lists recent venue pay-links.

## Conventions
- Amounts are **minor units** (cents). Currency defaults to `KES`.
- `/api/payments/create` and `/api/refunds` are **public** but rate-limited
  centrally in `server.ts` (see the auth-tenancy skill) — never gate them behind
  `requireAuth`.
- **UNITS (critical):** amounts are **minor units** (cents) end-to-end in the ledger.
  For a **succeeded** payment capture PesaSwap's **`amount_received`** (what actually
  settled), NOT the requested `amount` — M-Pesa/Daraja only moves **whole shillings**
  and **truncates** decimals (KES 1.99 → KES 1.00). See `settledAmount()`
  (`src/api/payments.ts`); failed/processing rows keep the requested amount.
- Provider config comes from `PESASWAP_API_KEY` / `PESASWAP_URL` /
  `PESASWAP_WEBHOOK_SECRET` / `PESASWAP_PROFILE_ID` (env), not the DB.
- **M-Pesa is server-side** (no publishable key): when live + KES + a phone,
  `handleCreatePayment` fires a Daraja STK (`payment_method=wallet` /
  `m_pesa_express`, needs `PESASWAP_PROFILE_ID`) returning `status:processing` +
  `stk:true`; the client polls `/status`, which confirms via PesaSwap and records
  the ledger on success (no webhook needed for M-Pesa). See the pesaswap-integration
  skill for the exact body. Verified live (KES 1 STK, receipt returned).
- **`PAYMENTS_TEST_MODE=1`** simulates a succeeded payment (no provider call) so the
  full journey can be tested end-to-end without live credentials; the ledger is
  still written (loyalty + settlement run). Set `0` + a real `PESASWAP_API_KEY`
  for live payments.
- **Never** log or store a PAN. Keep the SAQ-A posture (see `SECURITY.md`).
- Ledger writes are best-effort (`recordLedger`) — they must never block a payment.

## Common tasks
- **Resolve a short pay link:** `pay.tsx` reads `?i=INV-XXX` (invoices) or
  `?o=<token>` (QR orders → `/api/qr/pay/:token`) or `?r=<token>` (pay-links →
  `/api/pay-links/:token`) → server-authoritative amount → drives the pay flow.
  **Never trust an amount from the URL.**
- **`recordLedger` side effects (on a succeeded payment):** accrues loyalty points
  to the contact by **phone** (unique key), and settles a QR `orders.paid_at` when
  the **cumulative** succeeded payments for that `metadata.order_id` cover the order
  total — so **split / partial payments** don't prematurely close a shared bill.
  Both best-effort. It also tags each row with an **`initiator`** (`human` | `agent`)
  via `resolveInitiator(metadata)` — explicit `metadata.initiator` wins, else an
  `agent_id`/`agentRef` or an A2A `flow_type`/`channel` marks it `agent` (`db/35`).
- **Pay-links settle like normal payments:** `/pay?r=` sets `metadata.pay_link_id`;
  on success `recordLedger` calls `markPayLinkPaid(sql, payLinkId, paymentId)`
  alongside QR-order settlement, so paid/expired/cancelled status stays server-side.
- **Dashboard live payments:** `/dashboard/payments` has a "Request payment" modal
  that mints pay-links for any amount + optional description/phone and shares via
  `/api/share` (WhatsApp/Telegram/SMS) or copy; clickable rows open a transaction
  detail drawer with amount, tip, status/decline, M-Pesa REF, customer, flow,
  initiator and payment id.
- **Split-pay is server-authoritative:** `handleCreatePayment` clamps a charge with
  `metadata.order_id` to the order's remaining balance (rejecting a settled bill),
  so a guest can never overpay. Shares are computed in `src/lib/split-bill.ts`; the
  balance is exposed by `GET /api/qr/pay/:token`. QR order amounts are **minor
  units** end-to-end (the QR menu resolver converts whole-KES prices ×100).
- **Saved payment methods are DB-backed** (`customer_payment_methods`, `db/37` +
  `db/38`): `recordLedger` remembers the **M-Pesa** number on a successful payment;
  the **webhook** persists tokenised **card/wallet** methods (brand + last4 +
  provider token — never a PAN). `GET /api/customers/payment-methods?phone=`
  retrieves them from Postgres (was an in-memory Map) and returns `brand`/`last4`
  for inline display. The UNIQUE index is `(phone, COALESCE(provider_ref, kind))`,
  so one phone keeps **1 M-Pesa + many distinct cards/wallets**. `has_saved` stays
  false for M-Pesa STK (not a one-tap token), so the flow is unchanged; the
  `methods` list is for display/prefill. Merchants review them at
  `/dashboard/payment-methods` (`GET /api/payment-methods`).
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
