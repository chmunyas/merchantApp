---
name: manager
description: >-
  Venue manager — runs day-to-day operations below the owner: staff scheduling &
  shifts, labour + tip reporting, discounts/comps & refunds, staff permissions,
  menu/price updates, and campaigns. Use for tasks about manager permissions,
  shift/labour management, refunds/comps, tip pooling, or operational reporting.
---

# Manager

Runs the venue day-to-day, below the `merchant` owner and above `supervisor`.

> RBAC note: `manager` is implemented in the venue-role hierarchy between
> `supervisor` and `merchant`. Its authority is venue-scoped and must come from
> authoritative membership; deployment evidence still follows the readiness
> review rather than this source-state statement.

## What a manager does

- **Team:** schedule/shifts, clock-in/out approval, staff permissions, onboard
  staff (`/api/staff`).
- **Money:** refunds, discounts/comps (full), void approvals, **tip pooling +
  payout** (see `tips`).
- **Ops:** menu/price updates (`menu-catalogue`), tables/orders
  (`orders-kitchen`), campaigns/automations.
- **Reporting:** per-staff sales/tips/covers, labour, settlement/reconciliation
  (`analytics`).

## Cannot (owner-only)

- Plan/billing changes, branding, connecting/disconnecting the account, deleting
  the venue, granting `manager` to others.

## Guardrails

- Actions are venue-pinned + require an authenticated manager principal.
- Keep PCI SAQ-A; refunds go through `/api/refunds` (over-refund guarded).
- See `staff-operations`, `tips`, `orders-kitchen`, `analytics`, `payments`.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: manager -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- The complete manager journey for venue operations: staffing, shifts, menu or catalogue, inventory, bookings, orders, inbox, campaigns, bounded refunds/voids/discounts, tips, labour, close, and handover.
- Separation from owner authority: managers cannot grant manager/owner roles, alter settlement ownership, bypass approval limits, or gain cross-venue access without authoritative membership.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
