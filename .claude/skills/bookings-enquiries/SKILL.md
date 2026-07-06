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
- `POST /api/enquiries?venue=` — **public** (customer), rate-limited 10/min.
- `GET /api/enquiries?venue=` — dashboard read (send the token → venue-pinned).
- Booking counts: `/api/ai/command` ("covers today", "new enquiries").

## Conventions
- Customer submits are **public** — keep `POST /api/enquiries` open + rate-limited.
- Server rows carry `source = "web"`; merge into the dashboard by `id` and don't
  overwrite a local status change.
- Reservations/tables/floorplan currently live in the merchant localStorage store
  (synced to Postgres via `merchant_state`); enquiries are Postgres-authoritative.

## Guidelines
- Validate `customerName`; default covers/date/time server-side.
- New enquiry sources should still set a `source` and be venue-scoped.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
