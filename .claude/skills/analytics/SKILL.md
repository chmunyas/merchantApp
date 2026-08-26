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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: analytics -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Traceable, tenant-scoped operational metrics with explicit definitions, timezone, currency, filters, freshness, drill-through, pagination, and export behavior.
- Reproducible cross-channel timelines and reports whose aggregates can be reconciled to source records and whose access matches the viewer's role.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
