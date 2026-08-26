---
name: invoicing
description: >-
  Create, send, and track invoices — line items, tax, due dates, reminders,
  recurring billing, short public pay links, and status. Use when a task mentions
  invoices, billing, reminders, recurring/subscriptions, pay links, or the
  invoices dashboard.
---

# Invoicing & accounting

Omnichannel billing that shares one Postgres store with the AI agent and the pay
page.

## Key files

- `src/api/invoices.ts` — `/api/invoices` (GET/POST), `/api/invoices/:id/:action`,
  `/api/invoices/stats`, public `/api/invoices/payinfo`.
- `src/api/recurring.ts` — `/api/recurring` CRUD + `/api/invoicing/run` sweep.
- `src/lib/invoices.ts` (`createInvoice`, `listInvoices`), `src/lib/invoicing.ts`
  (`sendReminder`, `runReminders`, `runRecurring`, `recordPayment`).
- `src/lib/links.ts` — async `getBaseUrl(env)` + short `payLink(base, {number})`.
- `src/routes/dashboard/invoices.tsx` — the back-office UI.

## Endpoints (all venue-scoped)

- `POST /api/invoices` — **gated**; creates + optionally sends. Venue is derived
  from the JWT (never `body.venue`).
- `POST /api/invoices/publish` — **gated**; idempotently persists a client-side
  (MerchantApp / pesaswapApp) invoice, keyed on its client id → `number` (UPSERT on
  `(venue, number)`), so its shared link + QR resolve to a real, payable
  `/pay?i=<number>` page. Preserves an existing paid/void status.
- `POST /api/invoices/:id/:action` — `paid`, `cancel`, `remind`, etc. **gated**.
- `GET /api/invoices` · `/api/invoices/stats` — dashboard reads (send the token).
- `GET /api/invoices/payinfo?number=` — **public** (pay page).
- `POST /api/recurring` (+ `/:id/toggle`, DELETE) — **gated**; free plan caps 25.
- `POST /api/invoicing/run` — **public sweep** called by the bridge every 3 min.

## Conventions

- Invoice economics are KES-only until an FX ledger exists. Lines, quantities,
  tax, totals, and due dates pass strict server validation; issued economics are
  immutable and client `paid` status is never authoritative.
- Invoice payment holds serialize remaining balance. Manual mark-paid/pay actions
  fail closed; payments use server-bound intents. Unpaid voids create append-only
  A/R/revenue/tax reversals with reason and idempotency.
- Initial delivery and reminders persist to `invoice_communication_outbox`
  before adapters run; accepted/failed attempts use fenced retries.
- Gated endpoints use `resolveVenue(request, env, url)` — the JWT `venue` claim
  wins over `?venue=`/`body.venue` (tenant isolation). See auth-tenancy skill.
- Pay links must be **short + public**: build with `payLink(await getBaseUrl(env),
{ number })`, put the link on its own line in messages. Set
  `app_settings.public_base_url` for a real domain/tunnel — it **overrides
  everything** in `getBaseUrl`, so a stale value (e.g. a dead tunnel) silently
  breaks every invoice link + QR; keep it on the tier's reachable origin (deployed
  = the Worker URL; local = localhost). A link/QR is only payable if the invoice
  lives in that tier's database.
- Invoices remain the durable A/R document; the generic pay-links primitive
  (`/pay?r=<token>`, payments skill) is for lightweight ad-hoc payment requests.
- Reminders + recurring generation run via the `invoicing/run` sweep (bridge).

## Common tasks

- **Create + send:** `createInvoice(env, {...})` builds the record, resolves the
  pay link, and dispatches on the customer's channel.
- **Add a recurring cadence:** extend `runRecurring` in `invoicing.ts` and the
  cadence handling in `recurring.ts`.

## Guidelines

- Amounts are numeric; keep tax/line-item math in `src/lib/invoices.ts`.
- Free plan caps recurring schedules (`PLAN_LIMITS.recurring`) — return 402 on
  exceed, don't silently drop.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: invoicing -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Server-numbered invoice draft, approval, issue, delivery, tax, due date, partial payment, reminder, recurrence, credit/reversal, write-off, status, pay-link, and export lifecycle.
- Minor-unit payment reconciliation and accrual-accounting traceability so invoice issue recognises receivable and payment settles it without duplicate revenue.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
