---
name: crm-loyalty
description: >-
  Manage customers/contacts, loyalty tiers and points, and natural-language CRM
  queries. Use when a task mentions contacts, customers, loyalty, tiers (Bronze→
  Platinum), points, segments, or "top spenders / new enquiries" style questions.
---

# CRM & loyalty

The contact graph behind every channel — contacts are venue-scoped and shared by
the agent, invoicing and campaigns.

## Key files
- `src/api/backend.ts` — `/api/contacts` (GET/POST) + `/api/ai/command` (NL CRM).
- `src/routes/dashboard/contacts.tsx` — the back-office UI.
- `db/01-schema.sql` — `contacts` table (tier, points, total_spent, visits, tags).
- `db/27-loyalty-phone.sql` — **phone is the unique loyalty reference** per venue
  (`contacts_venue_phone_key`).
- `src/api/payments.ts` (`recordLedger`) — accrues points to the contact by phone
  on a successful payment; `src/lib/loyalty.ts` — tier ladder + `tierProgress`,
  `tierBenefits`, `pointsExpiry`.

## Endpoints
- `GET /api/contacts?venue=` — list (dashboard sends the token → venue-pinned).
- `POST /api/contacts` — create a contact.
- `POST /api/ai/command` — **gated** NL admin ("top spenders", "new enquiries",
  "covers today") → runs `runAiCommand`.

## Conventions
- Venue is resolved from the JWT (`resolveVenue`) — see the auth-tenancy skill.
- **Loyalty is keyed on the customer phone number** — `(venue_id, phone)` is unique
  (`contacts_venue_phone_key`). Points accrue via a phone-keyed UPSERT in
  `recordLedger` on the first transition of a payment into `succeeded`, so a phone
  is one loyalty identity per venue (never a duplicate contact).
- Tiers: `Bronze` → `Silver` → `Gold` → `Platinum`; default `Bronze`. Thresholds +
  "points to next tier" live in `src/lib/loyalty.ts` (`TIER_LADDER`, `tierProgress`).
- The same contact identity is used across WhatsApp/web/Telegram (identity graph);
  see the omnichannel-agent skill for the cross-channel timeline.

## Common tasks
- **Segment for a campaign:** segments (`all`, tier-based, etc.) are consumed by
  the campaigns-automations skill's broadcast endpoint.
- **Add a loyalty rule:** update points/tier logic where contacts are written and
  keep it venue-scoped.

## Guidelines
- Always scope contact reads/writes by the resolved venue.
- Keep `/api/ai/command` gated (it exposes business data).

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
