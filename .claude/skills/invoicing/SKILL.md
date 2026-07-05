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
- `POST /api/invoices/:id/:action` — `paid`, `cancel`, `remind`, etc. **gated**.
- `GET /api/invoices` · `/api/invoices/stats` — dashboard reads (send the token).
- `GET /api/invoices/payinfo?number=` — **public** (pay page).
- `POST /api/recurring` (+ `/:id/toggle`, DELETE) — **gated**; free plan caps 25.
- `POST /api/invoicing/run` — **public sweep** called by the bridge every 3 min.

## Conventions
- Gated endpoints use `resolveVenue(request, env, url)` — the JWT `venue` claim
  wins over `?venue=`/`body.venue` (tenant isolation). See auth-tenancy skill.
- Pay links must be **short + public**: build with `payLink(await getBaseUrl(env),
  { number })`, put the link on its own line in messages. Set
  `app_settings.public_base_url` for a real domain/tunnel.
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
