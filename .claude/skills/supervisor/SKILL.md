---
name: supervisor
description: >-
  Front-of-house shift lead — a staff member with elevated permissions: oversee
  the floor + inbox, approve small voids/discounts, assign tables/sections,
  reassign or escalate conversations, and view shift reports. Below manager. Use
  for tasks about shift-lead permissions, floor supervision, or approval flows.
---

# Supervisor (shift lead)

A `staff` member elevated to shift lead. Sits between `staff` and `manager`.

> RBAC note: `supervisor` is implemented in the venue-role hierarchy between
> `staff` and `manager`. Gate each shift-lead action behind an authenticated,
> venue-scoped supervisor principal; do not infer authority from a job title or
> request body.

## What a supervisor does

- **Floor:** assign tables/sections to servers; reassign open orders.
- **Inbox:** oversee conversations, reassign/hand off, escalate to manager; send
  manual replies (`/api/whatsapp/reply`).
- **Approvals:** small voids/discounts/comps within a manager-set limit.
- **Tips:** view the team's live tips for the shift (read-only).
- **Reports:** current-shift sales/covers/tips (read-only).

## Cannot (needs manager+)

- Refunds above a threshold, schedule edits, staff permission changes, menu/price
  edits, plan/billing.

## Guardrails

- Privileged (money) actions require an **authenticated** supervisor principal —
  never a request-body role (SECURITY.md Alert 5). Tenant-pinned to the venue.
- See `staff-operations`, `tips`, `orders-kitchen`, `auth-tenancy`.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: supervisor -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- The shift-lead journey for floor and inbox oversight, table or section assignment, bounded void/discount approval, conversation reassignment, exception escalation, shift reporting, and handover.
- Server-enforced approval thresholds and venue/shift scope so a supervisor cannot inherit manager configuration, finance, role-grant, or cross-venue authority through the UI or API.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
