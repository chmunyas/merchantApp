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

> RBAC note: today the roles are `admin | merchant | staff | customer |
> reseller_admin`. `supervisor` is a **target role** — add it to `UserRole` +
> `requireRole` and gate the actions below behind it.

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

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
