---
name: bookings-enquiries
description: >-
  Handle table bookings, customer enquiries, deposits, tables and floorplan. Use
  when a task mentions reservations, bookings, enquiries, covers, deposits,
  tables, or the /enquire page and dashboard enquiries.
---

# Bookings & enquiries

Customer booking requests flow from the PWA/agent into Postgres and surface in the
back office.

## Key files

- `src/api/backend.ts` — public `POST /api/enquiries` + gated `GET /api/enquiries`
  (Postgres `enquiries` table).
- `src/routes/enquire.tsx` — the public `/enquire` booking form (posts to the API).
- `src/routes/dashboard/enquiries.tsx` — back office; merges server enquiries with
  local by id (local status changes win).
- `db/01-schema.sql` — `enquiries` + `reservations` tables.
- `src/lib/agent.ts` — the agent's `create_enquiry` / `check_availability` tools.

## Endpoints

- `POST /api/enquiries?venue=` — **public** (customer), rate-limited 10/min. The
  row is **always** written to the resolved venue (token venue, else `?venue=`);
  a `body.venue` is ignored (no cross-tenant write).
- `GET /api/enquiries?venue=` — dashboard read (send the token → venue-pinned).
- `POST /api/agent/booking` — **confirmed** reservation for A2A/agents (capacity-
  checked, inserts `reservations` with `status='confirmed'`). Distinct from an
  enquiry (which is a pending request the back office confirms). See agentic-checkout.
- Booking counts: `/api/ai/command` ("covers today", "new enquiries").

## Conventions

- Customer submits are **public** — keep `POST /api/enquiries` open + rate-limited,
  but **never trust a body-supplied venue** — pin to the resolved venue.
- An **enquiry** is a pending request (`enquiries`, `status='new'`); a **booking**
  is a confirmed seat (`reservations`, `status='confirmed'`). The conversational
  agent creates enquiries; `POST /api/agent/booking` creates confirmed bookings.
- Server rows carry `source = "web"`; merge into the dashboard by `id` and don't
  overwrite a local status change.
- Reservations/tables/floorplan currently live in the merchant localStorage store
  (synced to Postgres via `merchant_state`); enquiries are Postgres-authoritative.
- Booking deposits can be collected through a shareable pay-link (`kind='deposit'`,
  `/pay?r=<token>`) in addition to the inline `/book` M-Pesa flow.

## Guidelines

- Validate `customerName`; default covers/date/time server-side.
- New enquiry sources should still set a `source` and be venue-scoped.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: bookings-enquiries -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Server-authoritative availability, enquiries, reservations, covers, tables, deposits, confirmation, amendment, cancellation, no-show, assignment, and staff handoff.
- Concurrency, timezone and trading-day rules, accessible customer communication, payment linkage, consent, audit, and recovery from provider or notification failure.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
