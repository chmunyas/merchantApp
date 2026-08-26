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
- `src/routes/dashboard/settlement.tsx` — internal batch estimates, refund
  adjustments, unbatched flags, run + history.
- `src/api/disputes.ts` — disputes / chargebacks + payment webhook-event audit trail.
- `db/25-settlement.sql` — `settlements` + `payments.settlement_id`.
- `db/40-payment-events.sql` — `payment_events` (webhook audit + idempotency).
- `db/41-disputes.sql` — `disputes` (chargebacks).

## Endpoints

- `GET /api/settlement/summary?from=&to=` — gross, refunds, estimated fees/net,
  batched/unbatched estimates, and pending refund adjustments.
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
- `run` creates an **internal estimate batch** and append-once
  `payments.settlement_id`; it is not bank reconciliation evidence. Post-batch
  refunds retain immutable reversals and never detach original membership.
- Provider evidence staging is immutable, KES-only, header/line balanced, and
  exact-reference matched. A manager-uploaded statement is not production proof
  until authenticated provider pull/signature and bank evidence are independently
  verified; live matching remains an operator gate.

## Guidelines

- Never double-settle: only batch payments with `settlement_id IS NULL`.
- Keep `run` gated to manager/merchant/admin; reads open to any authed operator.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: reconciliation -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Source-to-payment-to-fee-to-net-to-payout matching, resumable batches, explicit exceptions, line-level traceability, bank/POS/provider imports, approval, close, reopen, and audit-grade export.
- Idempotent and replay-safe recovery from delayed, duplicate, missing, reversed, partially refunded, unsynced, or mismatched transactions without editing settled history.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
