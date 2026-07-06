---
name: analytics
description: >-
  Read agent and channel analytics and cross-channel customer timelines. Use when
  a task mentions analytics, reporting, metrics, dashboards, message volumes, or a
  customer's cross-channel history.
---

# Analytics & reporting

Read-only insight over the omnichannel event/message stores.

## Key files
- `src/api/analytics.ts` — `GET /api/analytics/agent` (by-channel counts, etc.).
- `src/api/omni.ts` — `GET /api/timeline?phone=` (cross-channel identity timeline).
- `src/routes/dashboard/analytics.tsx` — the dashboard.

## Endpoints (venue-scoped, GET only)
- `GET /api/analytics/agent?venue=` — agent/channel analytics.
- `GET /api/timeline?venue=&phone=` — every message to/from a person across
  WhatsApp, web, Telegram, IG and SMS.

## Conventions
- Venue resolves from the JWT when a token is sent (`resolveVenue`); dashboards
  send it. These are reads — keep them side-effect free.
- Source data is the `events` + `messages` + `conversations` tables.

## Guidelines
- Prefer aggregate SQL over pulling rows into JS.
- Add new metrics as venue-scoped GETs; never mutate here.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
