---
name: campaigns-automations
description: >-
  Run segmented broadcasts and multi-step drip sequences across channels, and
  retry failed deliveries. Use when a task mentions campaigns, broadcasts, bulk
  send, marketing, automations, drip/sequences, enrollment, or the dead-letter
  queue.
---

# Campaigns & automations

Bulk + drip messaging over the same channel adapters as the agent.

## Key files
- `src/api/broadcast.ts` — `POST /api/broadcast` (gated) + `/api/broadcast/history`.
- `src/api/sequences.ts` — `/api/sequences` CRUD, `/enroll`, `/run` (sweep).
- `src/api/dlq.ts` — `/api/dlq` + `POST /api/dlq/retry` (re-send failed).
- `src/lib/broadcast.ts` (`sendBroadcast`), `src/lib/sequences.ts`
  (`enroll`, `runDueSteps`).
- `src/routes/dashboard/automations.tsx` — the UI.

## Endpoints (venue-scoped)
- `POST /api/broadcast?venue=` — **gated**; `{segment, channel, message}`.
- `POST /api/sequences` · `/enroll` — **gated**.
- `POST /api/sequences/run` — **public sweep** (bridge, every 3 min).
- `POST /api/dlq/retry` — **gated**; re-sends `events.status='failed'`.

## Conventions
- Broadcasts/sequences are **gated** and venue-pinned (`resolveVenue`); the two
  `*/run` sweeps are **public** (the bridge calls them) — never gate the sweeps.
- Segments come from the CRM (see crm-loyalty skill).
- Failed deliveries land in the DLQ (`events.status='failed'`) for retry.

## Guidelines
- Require a non-empty `message`; respect the customer's channel.
- Keep broadcasts idempotent enough to retry; log to `events` for history.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
