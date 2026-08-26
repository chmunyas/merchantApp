---
name: staff-operations
description: >-
  Front-of-house / back-of-house staff operations for the merchant app — staff
  login & roles, taking payment and sending the bill, orders/kitchen tickets,
  customers, and tips (attribution, pooling, reporting) — done both in the back
  office and hands-free via the omnichannel AI agent. Use for any task about what
  staff can do, staff PWA, tip attribution/pooling, order/table management, staff
  auth/roles, or benchmarking vs Sunday / Toast / Square / Lightspeed.
---

# Staff operations

The staff layer of the merchant app. The differentiator vs a classic POS is that
staff can also operate **hands-free through the AI agent** (WhatsApp/web) — "send
table 5 the bill", "how many covers today?", "who tipped tonight?".

## Roles (`src/lib/tenancy.ts`, `src/lib/auth.ts`)

The venue ladder is `staff < supervisor < manager < merchant`. `admin` is a
separate platform authority, `reseller_admin` is a separate organisation
authority, and `customer` does not inherit venue permissions.

- Staff login is server-authoritative: exact venue + normalized account + 6–8
  digit PIN, using salted scrypt hashes, row lockout, credential versioning, and
  a JWT carrying `staff_id` + venue. Plaintext/browser PINs are forbidden.
- **Multi-venue staff:** phone equality is explicitly not an authorization
  boundary. Staff currently sign in with a venue-scoped credential;
  `/api/staff/my-venues` does not yet grant cross-store authority. Switching
  stores needs an explicit, revocable assignment and session transition.
- `getDefaultRouteForRole('staff' | 'supervisor') → /staff-console`.

## What a staff member can do TODAY

| Area                   | Works                                                                                                        | Where                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Inbox takeover         | Read conversations, send manual replies                                                                      | `dashboard/inbox.tsx`, `/api/whatsapp/reply` |
| Customers/CRM          | View + add contacts, view history                                                                            | `dashboard/contacts.tsx`, `/api/contacts`    |
| Billing/payments       | Create/send invoices and pay links; privileged settlement/void/refund actions remain manager+                | `/api/invoices`, `/api/pay-links`, `pay.tsx` |
| Orders/kitchen         | Take orders and run live table/order state from the PWA and KDS without browser fallback for real venues | `/api/orders`, `SyncedTableServiceView`, `dashboard/orders.tsx` |
| Tips                   | View own tips; attribute captured tips to `staff_id`                                                         | `/api/tips/me`, `payments.staff_id`          |
| Shifts                 | Open/view/close own shift and receive a Z-report                                                             | `/api/shifts/*`, `db/33-shifts.sql`          |
| AI agent (staff scope) | create_invoice, get_todays_bookings, count_enquiries, search_contacts                                        | `src/lib/agent.ts` (role ≠ customer)         |

## Remaining gaps (the roadmap)

1. **Cross-store staff accounts** — phone equality is no longer an authorization
   boundary. Staff sign in separately to each venue until an explicit assignment
   account/linking model exists.
2. **Legacy customer pages** — PWA Quick Order, authenticated Tables and KDS use
  `/api/orders` and server-bound pay links. The old public `/table` and
  `/table/:id` pages still read the browser data tier; keep production traffic
  on unified QR until those legacy pages are removed or migrated.
3. **Tip payout operations** — attribution, pooling, reporting and payout ledgers
   exist. Live provider submission/reconciliation, complete role/device journeys
   and operator evidence remain production work.
4. **Attribution completeness** — `payments.staff_id`, `orders.staff_id` and
   authenticated staff sessions exist; every order/payment entry point must still
   prove it derives attribution from the principal or an authorised assignment.
5. **Approval and floor workflow** — shifts and table sections exist, but bounded
   supervisor void/discount approvals, durable section ownership, handover and
   exception reporting still need one server-authoritative journey.

## Production capabilities (complete end to end)

Bring parity with Sunday/Toast/Square on the essentials, then lean into the agent:

- **Auth:** DB-backed staff login (PIN or magic link) → session carrying
  `role:'staff'`, `staff_id`, `venue`. Manager-set permissions per staff.
- **Take payment / send bill:** from a table or an order → generate the pay link /
  QR, or "send table N the bill" via the agent; capture status + notify.
- **Orders:** use the existing `orders` + `order_items` authority for every client;
  complete fire/hold/split/transfer, conflict, degraded-mode and recovery behavior.
- **Tips:** use existing attribution, pool and payout ledgers for transparent
  direct/equal/by-hours/fixed distribution, staff statements and provider recovery.
- **Notifications:** push to the assigned server on payment/tip/failed payment
  (reuse `src/lib/push.ts` / `notifyStaff`).
- **Agent (staff scope) additions:** `send_bill(table)`, `take_payment`,
  `my_tips_today`, `open_orders`, `mark_order_ready`, `assign_table` — gated by
  staff auth (not just the WA allowlist).
- **Reporting:** per-staff sales, tips, covers, review score; manager roll-up.

## Implemented server foundation

- `orders` + `order_items` with venue/table/staff linkage and server-bound pay
  tokens (`db/18-orders.sql`, later order migrations).
- `payments.staff_id` + tip financial adjustments for attribution.
- `tip_pools`, source rows, allocations, payout details and payout orders
  (`db/17-tips.sql`, `db/70-tip-distribution.sql`, later finance migrations).
- Venue-scoped, versioned staff credentials and `shifts` (`db/58`, `db/33`).

## Guardrails

- Tenant isolation: every staff read/write pins to the token's `venue`
  (`venueFromPayload`), never `?venue=` — see the `auth-tenancy` skill.
- Staff role must come from an **authenticated principal** (staff login), not from
  a request body/allowlist for privileged money actions (see SECURITY.md, Alert 5).
- Keep PCI SAQ-A: staff never handle card data; they send a pay link / QR.
- Amounts are minor units; currency defaults KES.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: staff-operations -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Individual staff authentication, authoritative venue assignment, role-appropriate orders, kitchen, tables, customers, bills, payments, tips, shifts, notifications, handover, and offline/degraded recovery.
- No shared credentials or browser-local authority, restricted cost and finance visibility, fast session lock/revocation, managed-device behavior, audit attribution, and supervisor/manager escalation.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
