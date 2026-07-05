---
name: tips
description: >-
  Tip capture, attribution to the serving staff member, pooling (equal / by-hours
  / fixed), a payout ledger, and per-server tip reporting — plus tip suggestions
  at checkout. Benchmarked on Sunday's Tipjar. Use for tasks about tips,
  gratuities, tip pooling/attribution, tip payouts, or server tip dashboards.
---

# Tips

Turn the tip metadata already carried on a payment into a full attribution +
pooling + payout system (Sunday's moat).

## Today
- A payment carries `tip_amount`, `tip_recipient`, `server_name` metadata
  (`src/lib/pesaswap-payments.ts`) → persisted on `payments`
  (`src/api/payments.ts`); `tipSuggestions` in settings.
- **Missing:** attribution to a `staff_id`, pooling, payout ledger, reporting.

## Target model (add, following the `staff` per-row pattern)
- `payments.staff_id` (+ existing `tip_amount`) — attribute each tip.
- `tip_pools(venue_id, rule, period)` — rule = `direct | equal | by_hours | fixed`.
- `tip_allocations(pool_id, staff_id, amount, period, paid_at)` — payout ledger.
- API `/api/tips`: `GET ?scope=me|team` (per-server + team totals, shift/day),
  `POST /pool/run` (allocate a period), `GET /report`.
- **Agent (staff scope):** `my_tips_today`; **manager:** run pooling + payout.

## Guardrails
- Attribute only to an **authenticated** `staff_id`; never from a request body.
- Amounts minor units, KES default. Venue-pinned. Payout writes are an
  append-only ledger; best-effort must never block a payment.
- See `staff-operations`, `payments`, `manager` + SECURITY.md.
