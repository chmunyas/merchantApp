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
  provider payment only after consuming a hash-only, single-use server payment
  intent that binds venue, amount, currency, source, method, and tip limit.
- `GET /api/payments/:id/status` — poll payment status.
- `POST /api/refunds` — **manager+**, rate-limited; personal API tokens require
  `payments:write`. Ownership, original amount, cumulative settled refunds, and
  actor identity are server-derived. Only provider-settled refunds are booked.
- `POST /api/payments/:id/capture` — **gated**; captures a `capture:false`
  (manual-capture / card pre-auth hold) payment. Simulated in test mode.
- `POST /api/webhooks/pesaswap` — provider webhook. **Always fast-ACKs 200** (a
  non-2xx trips PesaSwap's `CallToMerchantFailed` + 24h of retries). Trust is a
  **local HMAC check only** (`x-webhook-signature-512`, fallback `-256`, over the raw
  body) — we do **NOT** verify-by-callback in the handler because that ~1s round-trip
  tripped PesaSwap's aggressive delivery timeout. A signature-verified payload is
  processed inline (confirms the ledger via `recordLedger`, persists tokenised
  card/wallet saved methods SAQ-A, and records any `refunds[]`); anything unsigned is
  ACKed and reconciled by the **pull paths** below (which re-fetch with our api-key,
  so a forged webhook can never be booked).
- `POST /api/payments/sync` — **gated (manager+)** Force Sync: pulls the authoritative
  state from PesaSwap now — recent **refunds** (`POST /refunds/list`) + any stuck
  `processing` payments — so a merchant can resync on demand. Powers the "Force sync"
  button on `/dashboard/payments`. Returns `{ refundsSynced, paymentsSynced }`.
- `GET /api/payment-methods` — **gated (manager+)** merchant view: all saved
  customer methods joined to contacts (name/tier) + M-Pesa/card/wallet counts.
  Renders at `/dashboard/payment-methods`.
- `GET /api/payments/list` — **gated (manager+)** DB-backed ledger: every real
  attempt (any status) for the venue, with the M-Pesa receipt (`provider_ref` =
  `connector_transaction_id`, e.g. `UG75TAWWYH`), decline reason, tip + initiator.
  Each row also carries `refundedAmount` (minor units refunded on it) and, for a
  refund row, `refundOf` + `refundReason`. Refund reconciliation is paginated and
  runs through Force Sync plus the scheduled recovery sweep, so dashboard-initiated
  refunds appear even when the outgoing webhook fails. Powers the "Live payments" panel on
  `/dashboard/payments` (localStorage demo data alone never showed real sales).
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
- `/api/payments/create` remains customer-facing and rate-limited but requires a
  `payment_intent_token`; client amount/venue/source metadata is never authority. `/api/refunds`
  is a privileged money action and must remain manager+ with `payments:write`
  enforcement for API tokens.
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
- Payment state transitions, first-success events, and outbox rows commit in one
  PostgreSQL transaction. Consumers use fenced leases plus an atomic effect marker
  and domain mutation; failures remain visible and retry on the Worker schedule.
  A provider acceptance still does not prove every downstream projection is done.
- **Refunds are pull-reconciled + event-booked.** A refund raised from the PesaSwap
  dashboard reaches the paginated pull reconcile. Each settled refund is written
  atomically as its own `payments` row (`kind='refund'`, `status='refunded'`),
  immutable reversal snapshot, financial event/outbox, reservation completion,
  and parent `refunded` / `partially_refunded` projection. `recordRefundRow` is
  **idempotent on the refund id**,
  so learning about the same refund from webhook AND pull never double-posts. Because
  PesaSwap keeps the payment `status='succeeded'` and puts the money-back only in
  `refunds[]`, always derive refund state from that array, not the top-level status.

## Common tasks

- **Resolve a short pay link:** `pay.tsx` reads `?i=INV-XXX` (invoices) or
  `?o=<token>` (QR orders → `/api/qr/pay/:token`) or `?r=<token>` (pay-links →
  `/api/pay-links/:token`) → server-authoritative amount → drives the pay flow.
  **Never trust an amount from the URL.**
- **Financial-event consumers (on a succeeded payment):** accrue loyalty points
  to the contact by **phone** (unique key), and settles a QR `orders.paid_at` when
  the **cumulative** succeeded payments for that `metadata.order_id` cover the order
  total — so **split / partial payments** don't prematurely close a shared bill.
  Consumers are transactionally replay-safe. The payment row also carries an
  **`initiator`** (`human` | `agent`)
  via `resolveInitiator(metadata)` — explicit `metadata.initiator` wins, else an
  `agent_id`/`agentRef` or an A2A `flow_type`/`channel` marks it `agent` (`db/35`).
- **Pay-links settle like normal payments:** `/pay?r=` sets `metadata.pay_link_id`;
  on success `recordLedger` calls `markPayLinkPaid(sql, payLinkId, paymentId)`
  alongside QR-order settlement, so paid/expired/cancelled status stays server-side.
- **Dashboard live payments:** `/dashboard/payments` has a "Request payment" modal
  that mints pay-links for any amount + optional description/phone and shares via
  `/api/share` (WhatsApp/Telegram/SMS) or copy; clickable rows open a transaction
  detail drawer with amount, tip, status/decline, M-Pesa REF, customer, flow,
  initiator and payment id. The authenticated `/pesaswapApp` Ledger consumes the
  same `PaymentLedgerRow` projection, including refunds, source id and failure
  reason; it never substitutes local transactions when the server read fails.
- **Split-pay is server-authoritative:** `handleCreatePayment` clamps a charge with
  `metadata.order_id` to the order's remaining balance (rejecting a settled bill),
  so a guest can never overpay. Shares are computed in `src/lib/split-bill.ts`; the
  balance is exposed by `GET /api/qr/pay/:token`. QR order amounts are **minor
  units** end-to-end (the QR menu resolver converts whole-KES prices ×100).
- **Saved payment methods are DB-backed** (`customer_payment_methods`, `db/37` +
  `db/38`): `recordLedger` remembers the **M-Pesa** number on a successful payment;
  the **webhook** persists tokenised **card/wallet** methods (brand + last4 +
  provider token — never a PAN). Public phone-only retrieval is disabled; customer
  reuse requires a future verified payment-session credential. The UNIQUE index is `(venue_id, phone, COALESCE(provider_ref, kind))`,
  so one phone keeps **1 M-Pesa + many distinct cards/wallets**. `has_saved` stays
  false for M-Pesa STK (not a one-tap token), so the flow is unchanged; the
  `methods` list is for display/prefill. Merchants review them at
  `/dashboard/payment-methods` (`GET /api/payment-methods`).
- **Add a webhook side effect:** update `handleWebhook` in `payments.ts` and
  persist status changes to the `payments` ledger via `recordLedger`.

## Guidelines

- Validate `amount > 0` before calling the provider.
- Keep idempotency (`Idempotency-Key`) on create + refund.
- When adding ledger fields, migrate in a new `db/NN-*.sql`; keep source state +
  event enqueue atomic and add a fenced replay-safe consumer for each side effect.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: payments -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Server-bound amount and payee authority, idempotent create/confirm/capture, provider-authenticated status, tips, split payments, pay links, refunds, disputes, reversals, receipts, and recoverable webhook/pull reconciliation.
- Minor-unit arithmetic, PCI scope control, no PAN or sensitive authentication data in application systems, maker-checker controls, immutable ledger linkage, observability, provider failure handling, and duplicate-money prevention.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
