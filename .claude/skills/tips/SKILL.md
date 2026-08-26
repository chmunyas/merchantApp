---
name: tips
description: >-
  Tip capture, attribution to the serving staff member, pooling (equal / by-hours
  / fixed), a payout ledger, and per-server tip reporting — plus tip suggestions
  at checkout. Benchmarked on Sunday's Tipjar. Use for tasks about tips,
  gratuities, tip pooling/attribution, tip payouts, or server tip dashboards.
---

# Tips

The tip pipeline captures customer gratuity, attributes it, allocates immutable
pool periods and records payout requests. Live payout provider reconciliation is
still a separate production boundary.

## Today

- A payment carries `tip_amount`, `tip_recipient`, `server_name` metadata
  (`src/lib/pesaswap-payments.ts`) → persisted on `payments`
  (`src/api/payments.ts`); `tipSuggestions` in settings.
- **In-flow customer tipping is live:** `/pay` offers tip suggestions
  (None / 5 / 10 / 15% / custom) on top of the bill and a serving-staff picker
  (venue's tippable staff from `GET /api/qr/pay/:token`), passing `tip_amount`
  (minor units) + `staff_id`. The tip is **excluded from the order balance**
  (`src/lib/tip.ts`, `src/routes/pay.tsx`).
- Pooling supports direct/equal/by-hours/fixed over immutable non-overlapping
  periods with deterministic rounding. Payout requests remain pending until a
  verified provider event confirms transfer and posts the GL. Live provider
  submission/reconciliation and migration parity remain operator work.

## Implemented model

- `payments.staff_id` (+ existing `tip_amount`) — attribute each tip.
- `tip_pools(venue_id, rule, period)` — rule = `direct | equal | by_hours | fixed`.
- `tip_allocations(pool_id, staff_id, amount, period, paid_at)` — payout ledger.
- API `/api/tips`: `GET ?scope=me|team` (per-server + team totals, shift/day),
  `POST /pool/run` (allocate a period), `GET /report`.
- **Agent (staff scope):** `my_tips_today`; **manager:** run pooling + payout.

## Guardrails

- Attribute a **staff-initiated** tip only to an **authenticated** `staff_id`; never
  from a request body. (Exception: a **customer** tip on `/pay` legitimately targets
  a `staff_id` the guest picked from the venue's public tippable-staff list — that is
  attribution the guest is entitled to make, and it moves no extra money: the tip is
  clamped on top of the bill and excluded from the order balance.)
- Amounts minor units, KES default. Venue-pinned. Payout writes are an
  append-only ledger; best-effort must never block a payment.
- See `staff-operations`, `payments`, `manager` + SECURITY.md.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: tips -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Customer tip capture, server attribution, configurable pooling, hours or fixed-share inputs, approval, payout ledger, reversal, reporting, statement, and employee visibility.
- Minor-unit conservation from capture through distribution and payout, transparent rules, locked periods, compensating corrections, role separation, privacy, and reconciliation to payment and accounting entries.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
