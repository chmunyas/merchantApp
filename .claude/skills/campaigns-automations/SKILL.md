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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: campaigns-automations -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Consent-aware segmentation, preview, approval, scheduling, quiet hours, frequency limits, suppression, delivery status, retry, dead-letter recovery, pause, cancellation, and attribution.
- Channel-policy and role enforcement for every broadcast or sequence step, with test-send isolation and auditable actor, audience, content version, and outcome.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
