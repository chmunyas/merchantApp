---
name: reconciliation
description: >-
  Settlement + reconciliation for bank/merchant trust — batch succeeded payments,
  flag unreconciled transactions, and compute fees/net. Use when a task mentions
  settlement, reconciliation, payouts, fees, net, or matching payments to a bank
  statement.
---

# Reconciliation & settlement

Turns the raw payments ledger into trustworthy money movement: which
transactions have been settled, which are still outstanding, and what the fees
and net payout are. Extends the Notebook from "what did I sell" to "what did I
get paid".

## Key files
- `src/api/settlement.ts` — summary, batches, `POST /api/settlement/run`.
- `src/routes/dashboard/settlement.tsx` — cards, unreconciled flags, run + history.
- `src/api/disputes.ts` — disputes / chargebacks + payment webhook-event audit trail.
- `db/25-settlement.sql` — `settlements` + `payments.settlement_id`.
- `db/40-payment-events.sql` — `payment_events` (webhook audit + idempotency).
- `db/41-disputes.sql` — `disputes` (chargebacks).

## Endpoints
- `GET /api/settlement/summary?from=&to=` — gross, fees, net, reconciled/unreconciled.
- `GET /api/settlement` · `GET /api/settlement/:id` — batches + batch detail.
- `POST /api/settlement/run` — **manager+**; batch unsettled succeeded payments.
- `GET /api/disputes[?status=]` · `GET /api/disputes/:id` — **gated**, venue-scoped;
  chargebacks + an open-count/open-amount summary. Lifecycle:
  open → under_review → won | lost | withdrawn.
- `GET /api/payment-events[?payment_id=&limit=]` — **gated**; the incoming-webhook
  audit timeline (matches the PesaSwap dashboard).
- `POST /api/shifts/open` · `GET /api/shifts/current` · `POST /api/shifts/close`
  · `GET /api/shifts` — staff shift lifecycle + **end-of-shift Z-report** (digital
  sales + tips + tx count for the window, plus a cash drawer reconciliation:
  float + cash sales vs counted = variance). `src/lib/shifts.ts` `zReport` + `db/33`.

## Conventions
- Amounts minor units, KES; succeeded = `('succeeded','paid','captured')`.
- **Every trusted webhook is persisted** to `payment_events` (idempotent on the
  provider event id) for an auditable timeline; disputes are upserted to `disputes`
  from the payment's `disputes[]` array or a dispute event (mirrors the refund path
  in `api/payments.ts`). The write path is the webhook only — the APIs are reads.
- Pay-link payments are normal ledger payments tagged with `pay_link_id`; settlement
  and reconciliation treat them like any other succeeded payment.
- `FEE_RATE` (default 1.5%) is an **estimate** — real fees come from the provider
  webhook/statement when live. `net = gross - fees`.
- `run` stamps `payments.settlement_id`; reconciled = has a settlement_id.

## Guidelines
- Never double-settle: only batch payments with `settlement_id IS NULL`.
- Keep `run` gated to manager/merchant/admin; reads open to any authed operator.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
