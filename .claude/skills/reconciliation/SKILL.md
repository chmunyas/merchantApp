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
- `db/25-settlement.sql` — `settlements` + `payments.settlement_id`.

## Endpoints
- `GET /api/settlement/summary?from=&to=` — gross, fees, net, reconciled/unreconciled.
- `GET /api/settlement` · `GET /api/settlement/:id` — batches + batch detail.
- `POST /api/settlement/run` — **manager+**; batch unsettled succeeded payments.

## Conventions
- Amounts minor units, KES; succeeded = `('succeeded','paid','captured')`.
- `FEE_RATE` (default 1.5%) is an **estimate** — real fees come from the provider
  webhook/statement when live. `net = gross - fees`.
- `run` stamps `payments.settlement_id`; reconciled = has a settlement_id.

## Guidelines
- Never double-settle: only batch payments with `settlement_id IS NULL`.
- Keep `run` gated to manager/merchant/admin; reads open to any authed operator.
