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

## Core API surface (see /llms.txt for every page)
- **Payments**: Create, Update, Confirm, Capture, Cancel, Retrieve, List,
  Session-token, Incremental-authorization, 3DS.
- **Refunds**: create/list/retrieve (map to `/api/refunds`).
- **Customers** + **Payment Methods**: create/list/retrieve/update/delete, set
  default — for saved-card / one-tap reuse.
- **Mandates**: create via Payments/Create `mandate_object` → recurring billing.
- **Disputes**: list/retrieve (chargebacks).
- **Payouts / Routing / Events / Merchant Account / Organization / API Key**.

## How it maps to this app
- `src/api/payments.ts` — `getEnv(runtimeEnv)` reads `PESASWAP_API_KEY` /
  `PESASWAP_WEBHOOK_SECRET` / `PESASWAP_URL` from the **Worker `env` binding**
  (not `process.env` — secrets land on `env`). `handleCreatePayment` →
  `POST ${PESASWAP_URL}/payments`; `handleRefund` → `/refunds`; `handleWebhook`
  verifies the HMAC signature and is **fail-closed** (503 when the secret is unset).
- `src/lib/pesaswap-payments.ts` — client SDK helpers (`executePayment`,
  `loadHyperLoader`, `buildPaymentMetadata`) + `VITE_PESASWAP_PUBLISHABLE_KEY`.
- `src/routes/pay.tsx` — hosted checkout (`/pay?i=INV-XXX`, QR `?tapgo=`).
- `db/13-payments.sql` — durable `payments` ledger (minor units).

## Go-live checklist
1. Create a **production API key** in the PesaSwap dashboard (keep sandbox for tests).
2. Set worker secrets (from the app container):
   `wrangler secret put PESASWAP_API_KEY`, `wrangler secret put PESASWAP_WEBHOOK_SECRET`.
3. Set `PESASWAP_URL=https://api.pesaswap.io` (prod) or the sandbox URL — add to
   `wrangler.toml [vars]` or as a secret; **not** `app.pesaswap.io`.
4. Set `VITE_PESASWAP_PUBLISHABLE_KEY` in the build env (CI) so the client SDK loads.
5. Register the webhook URL `https://<app>/api/webhooks/pesaswap` in the dashboard
   with the same `PESASWAP_WEBHOOK_SECRET`. Verify a test event is accepted (200)
   and a bad-signature event is rejected (401).
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
