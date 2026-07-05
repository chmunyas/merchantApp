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

> RBAC note: `manager` is a **target role** to add to `UserRole` + `requireRole`
> (today: `admin | merchant | staff | customer | reseller_admin`).

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
