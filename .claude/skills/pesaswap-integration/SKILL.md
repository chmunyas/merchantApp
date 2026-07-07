---
name: pesaswap-integration
description: >-
  Implement the PesaSwap payments platform on this app via its live SDK/API —
  base URLs, api-key/publishable-key auth, the Create→Confirm→Capture payment
  lifecycle, refunds, customers, saved payment methods, mandates (recurring),
  webhooks/events, and going-live config. Use for any task about integrating
  PesaSwap, enabling live payments, wiring the payments API/SDK, webhooks, or
  moving from sandbox to production. Docs: https://docs.pesaswap.io (index at
  /llms.txt).
---

# PesaSwap integration (live SDK/API)

How to wire this app to the real PesaSwap payments platform. Reference docs:
`https://docs.pesaswap.io` — full page index at `https://docs.pesaswap.io/llms.txt`.

## Environments & base URLs
| Environment | Base URL |
|-------------|----------|
| Sandbox     | `https://api.sandbox.pesaswap.io` |
| Production  | `https://api.pesaswap.io` |

> ⚠️ `PESASWAP_URL` must be the **API** base above — **not** `https://app.pesaswap.io`
> (that's the dashboard). `src/api/payments.ts` calls `${PESASWAP_URL}/payments`,
> so a wrong base silently fails. Sign up + get keys at `https://app.pesaswap.io`.

## Authentication (two keys)
- **`api-key`** — *secret*, server-side only. Authenticates all server→PesaSwap
  calls (`Authorization` / `api-key` header). Never expose it; never log it; never
  put it in the DB. Store as the `PESASWAP_API_KEY` worker secret.
- **publishable key** — public, client-side. Identifies the account for client
  calls that use a `client_secret` (e.g. listing a payment's methods). Store as
  `VITE_PESASWAP_PUBLISHABLE_KEY` (build-time).
- **webhook secret** — HMAC secret to verify inbound webhooks. Store as
  `PESASWAP_WEBHOOK_SECRET`.

## Payment lifecycle
Two journeys (from `POST /payments`):
1. **One-shot** — attach a payment method + `confirm=true` + `capture_method=automatic`
   in the Create call → done in a single request.
2. **Multi-step** — `Create` → `Update` → `Confirm` → `Capture`. Create returns a
   **`client_secret`**; use it with the **publishable key** for client-side calls.

Amounts are **minor units** (cents); currency defaults to `KES` in this app.

## M-Pesa STK (Daraja) — server-side, no publishable key (VERIFIED LIVE)
M-Pesa is confirmed **entirely server-side** with the api-key — no publishable key
/ HyperLoader — which sidesteps any client-SDK/env mismatch. `handleCreatePayment`
(when live + KES + a phone) sends a **one-shot** create+confirm:
```jsonc
POST /payments   // header api-key
{ "amount": 100, "currency": "KES", "confirm": true, "capture_method": "automatic",
  "profile_id": "<PESASWAP_PROFILE_ID>",           // REQUIRED on every /payments call
  "payment_method": "wallet", "payment_method_type": "m_pesa_express",
  "payment_method_data": { "wallet": { "m_pesa_express": {} } },
  "customer": { "id": "cus_…", "phone": "7XXXXXXXX", "phone_country_code": "+254" },
  "billing":  { "phone": { "number": "7XXXXXXXX", "country_code": "+254" }, "address": { "country": "KE" } } }
```
Returns `status:processing` + an STK push to the handset. The client then **polls**
`GET /api/payments/:id/status`, which queries PesaSwap for the terminal status and
records the ledger on first success (**this replaces the webhook** for M-Pesa —
loyalty/order settlement run without `PESASWAP_WEBHOOK_SECRET`). `connector=daraja`;
`connector_transaction_id` is the M-Pesa receipt. Helpers: `normalizeKenyanPhone`,
`mapPesaSwapStatus` (`src/api/payments.ts`).

## Core API surface (see /llms.txt for every page)
- **Payments**: Create, Update, Confirm, Capture, Cancel, Retrieve, List,
  Session-token, Incremental-authorization, 3DS.
- **Refunds**: create (`/api/refunds`), **list (`POST /refunds/list`)**, retrieve.
  `/refunds/list` (POST `{ limit }`) is the reconcile source — `reconcileRefunds`
  pulls it to sync dashboard-initiated refunds that never arrive as webhooks.
- **Customers** + **Payment Methods**: create/list/retrieve/update/delete, set
  default — for saved-card / one-tap reuse.
- **Mandates**: create via Payments/Create `mandate_object` → recurring billing.
- **Disputes**: list/retrieve (chargebacks).
- **Payouts / Routing / Events / Merchant Account / Organization / API Key**.

## How it maps to this app
- `src/api/payments.ts` — `getEnv(runtimeEnv)` reads `PESASWAP_API_KEY` /
  `PESASWAP_WEBHOOK_SECRET` / `PESASWAP_URL` from the **Worker `env` binding**
  (not `process.env` — secrets land on `env`). `handleCreatePayment` →
  `POST ${PESASWAP_URL}/payments`; `handleRefund` → `/refunds`; `reconcileRefunds`
  → `POST /refunds/list`; `handleWebhook` **always fast-ACKs 200** (no synchronous
  network call) and processes only signature-verified payloads inline — everything
  else is reconciled by the pull paths.
- `src/lib/pesaswap-payments.ts` — client SDK helpers (`executePayment`,
  `loadHyperLoader`, `buildPaymentMetadata`) + `VITE_PESASWAP_PUBLISHABLE_KEY`.
- `src/routes/pay.tsx` — hosted checkout (`/pay?i=INV-XXX`, QR `?tapgo=`).
- `db/13-payments.sql` — durable `payments` ledger (minor units).
- **Saved methods / one-tap reuse** — `handleWebhook`'s success branch
  persists tokenised card/wallet methods (token id + brand + last4, **never a PAN**)
  to `customer_payment_methods` (`db/37` + `db/38`, UNIQUE `(phone, COALESCE(
  provider_ref, kind))`). Read back per phone via
  `GET /api/customers/payment-methods?phone=`; merchants review all of them at
  `/dashboard/payment-methods` (`GET /api/payment-methods`, manager+). This is the
  Customers + Payment Methods API surface, wired to the customer's **phone**.

## Webhooks — payload, signature & delivery (verified against docs.pesaswap.io)
- **Envelope** (Hyperswitch-derived): `{ event_type, event_id, content: { object } }`,
  **OR the payment object at the TOP LEVEL** (live M-Pesa sends `{ payment_id, status,
  amount, amount_received, refunds[], … }` with no wrapper). Event names are
  **underscored**: `payment_succeeded`, `payment_failed`, `payment_captured`,
  `payment_cancelled`, `refund_succeeded`, `dispute_opened`, … (NOT dotted).
  `processWebhook` reads `body.event_type ?? body.type` and the resource from
  `content.object ?? content ?? data ?? (top-level)`, so it accepts every shape.
- **Always fast-ACK 200 — never block on I/O.** PesaSwap/Hyperswitch uses an
  **aggressive delivery timeout**: a ~1.4s response (an inline verify-by-callback
  `GET /payments/{id}`) trips **`CallToMerchantFailed`** + 24h of retries. So the
  handler does **NO synchronous network call** — it responds in ~300ms.
- **Trust = local HMAC only.** When `PESASWAP_WEBHOOK_SECRET` (=
  business-profile `payments_response_hash_key`) is set and the signature
  (`x-webhook-signature-512` HMAC-SHA512, fallback `-256`) matches the **raw body**
  (hex, case-insensitive), the payload is processed inline. Otherwise we still
  **ACK 200** (never 401/503 — those cause `CallToMerchantFailed`) and let the
  **pull reconcile** establish the authoritative state.
- **Pull reconcile is the durable path.** The webhook is best-effort; authoritative
  sync comes from re-fetching with our api-key: `handleGetPaymentStatus` (client
  `/status` poll), `reconcileRefunds` (`POST /refunds/list`) on `/api/payments/list`,
  and `POST /api/payments/sync` (Force Sync). A forged webhook can never be booked
  because state is confirmed against PesaSwap, not the webhook body.
- **Refunds**: PesaSwap keeps the payment `status='succeeded'` and records the money-back
  **only in `refunds[]`** (`{ refund_id, amount (minor), status, connector_refund_id,
  refund_arn, reason }`). `recordRefundRow` books each as a `kind='refund'` ledger row
  (idempotent on `refund_id`) + flips the parent to `refunded`/`partially_refunded`.
- **Idempotent by design**: `recordLedger` gates loyalty accrual + saved-method writes
  on `firstSuccess`, every write is `ON CONFLICT … DO UPDATE`, and `recordRefundRow`
  short-circuits on an existing refund id — so a duplicate delivery never double-posts.
- Register `https://<app>/api/webhooks/pesaswap` in the dashboard (Developer → Payment
  Settings → Webhook Setup); pasting `PESASWAP_WEBHOOK_SECRET` enables inline processing,
  but sync works without it via the pull paths.

## Saving a card/wallet (setup_future_usage)
A card/wallet is only tokenised (and therefore only surfaces on a webhook to persist)
when the **create** call sets `setup_future_usage: "on_session" | "off_session"` **and**
a `customer_id` is attached; the SDK collects consent (`customer_acceptance`) on confirm.
Reuse a saved token off-session with `off_session: true` + `recurring_details: { type:
"payment_method_id", data: "pm_…" }`. `handleCreatePayment` forwards all three fields
when present (additive — omitted by the default M-Pesa STK flow). List a customer's
saved methods provider-side with `GET /customers/{customer_id}/payment_methods`.

## Go-live checklist
1. Create a **production API key** in the PesaSwap dashboard (keep sandbox for tests).
2. Set worker secrets (from the app container):
   `wrangler secret put PESASWAP_API_KEY`, `wrangler secret put PESASWAP_WEBHOOK_SECRET`.
3. Set `PESASWAP_URL=https://api.pesaswap.io` (prod) or the sandbox URL — add to
   `wrangler.toml [vars]` or as a secret; **not** `app.pesaswap.io`.
4. Set `VITE_PESASWAP_PUBLISHABLE_KEY` in the build env (CI) so the client SDK loads.
5. Register the webhook URL `https://<app>/api/webhooks/pesaswap` in the dashboard
   (pasting `PESASWAP_WEBHOOK_SECRET` enables inline processing). Verify a delivery is
   accepted (**200 in ~300ms** — never `CallToMerchantFailed`); unsigned/forged events
   are ACKed but only booked after the pull reconcile confirms them with our api-key.
6. Confirm the flow end-to-end in **sandbox** first: Create → Confirm → webhook →
   ledger row → dashboard notification.

## Compliance (PCI-DSS SAQ-A)
- Card data **never** touches our server — use PesaSwap hosted fields / redirect so
  we only ever hold tokens + `payment_id`. This keeps us at **SAQ-A**.
- Keep `Idempotency-Key` on create + refund. Guard over-refunds. Enforce webhook
  signatures (already fail-closed). See `SECURITY.md`.

## Guardrails
- Never log/store a PAN or the `api-key`. Never move the secret key into the DB.
- Validate `amount > 0` before calling the provider.
- Don't break the public pay-link flow (`/pay?i=` → `/api/invoices/payinfo`).
- Thread the Worker `env` into any new payments code path (don't read secrets from
  `process.env`/`globalThis` — they're empty on Workers).

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
