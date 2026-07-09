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

## Roles (`src/lib/auth.ts`)
`admin` (platform) · `merchant` (owner) · `staff` · `customer` · `reseller_admin`.
- Staff role is assigned via the demo **PIN login** (`src/routes/staff-login.tsx`
  → `getDemoStaffByPin`) **and** via the **WhatsApp allowlist** (`wa_allowlist`,
  `src/lib/inbound.ts`) — an allowlisted number is treated as `staff`/`admin`.
- **Multi-venue staff:** a staff member's per-venue `staff` rows are linked by
  **phone**, so one PIN login can list (`GET /api/staff/my-venues`) and switch
  (`POST /api/auth/staff-switch-venue`, re-mints the staff JWT — verified same
  phone + active there) between every store they work at. Surfaced as a store
  switcher on `/staff-console`. Client: `staffMyVenues` / `staffSwitchVenue`.
- `getDefaultRouteForRole('staff') → /merchant` (today a marketing page, not an
  ops console — see Gaps).

## What a staff member can do TODAY
| Area | Works | Where |
|------|-------|-------|
| Inbox takeover | Read conversations, send manual replies | `dashboard/inbox.tsx`, `/api/whatsapp/reply` |
| Customers/CRM | View + add contacts, view history | `dashboard/contacts.tsx`, `/api/contacts` |
| Billing/payments | Create invoice, pay link, mark paid, remind, void | `/api/invoices`, `/api/payments`, `pay.tsx` |
| Orders/kitchen | View + change ticket status (new→served) | `dashboard/orders.tsx` — **localStorage only** |
| AI agent (staff scope) | create_invoice, get_todays_bookings, count_enquiries, search_contacts | `src/lib/agent.ts` (role ≠ customer) |
| Staff directory | Add/list/remove team members | `/api/staff`, settings "User management" |

## What's MISSING / stubbed (the roadmap)
1. **Auth-backed staff login** — the PIN login uses a demo snapshot, not the DB
   `staff` table; there's no per-staff credential/session tied to a `staff.id`.
2. **Server-authoritative orders** — orders live in `localStorage`
   (`src/lib/realtime.ts` `pesaswap.kitchen.orders`); no `orders` table/API.
3. **Tips** — only metadata (`tip_amount`, `server_name`) is carried on a payment;
   **no per-server attribution, no pooling (Tipjar-style), no tip reporting/payout.**
4. **Links** — `staff.id` is not a FK on `payments`/`orders`; no staff↔login link,
   so performance/tips can't be attributed.
5. **Clock-in/out + shifts, void/comp approvals, section/table assignment** — none.

## Target capabilities (what staff + the agent SHOULD do)
Bring parity with Sunday/Toast/Square on the essentials, then lean into the agent:
- **Auth:** DB-backed staff login (PIN or magic link) → session carrying
  `role:'staff'`, `staff_id`, `venue`. Manager-set permissions per staff.
- **Take payment / send bill:** from a table or an order → generate the pay link /
  QR, or "send table N the bill" via the agent; capture status + notify.
- **Orders:** `orders` + `order_items` tables (venue + table + `staff_id`), status
  lifecycle, kitchen tickets; fire/hold/split/transfer; migrate off localStorage.
- **Tips:** attribute a tip to the serving `staff_id`; **pooling** rules (equal /
  by-hours / fixed) + a payout ledger; a **per-server tip dashboard** (today/shift).
- **Notifications:** push to the assigned server on payment/tip/failed payment
  (reuse `src/lib/push.ts` / `notifyStaff`).
- **Agent (staff scope) additions:** `send_bill(table)`, `take_payment`,
  `my_tips_today`, `open_orders`, `mark_order_ready`, `assign_table` — gated by
  staff auth (not just the WA allowlist).
- **Reporting:** per-staff sales, tips, covers, review score; manager roll-up.

## Data model to add (follow the `staff` per-row pattern)
- `orders(id, venue_id, table_id, staff_id, status, total, created_at)` +
  `order_items(order_id, name, qty, price, notes)`.
- `payments.staff_id` + `payments.tip_amount` (attribution).
- `tip_pools(venue_id, rule, period)` + `tip_allocations(pool_id, staff_id, amount, paid_at)`.
- `staff_sessions` / link `app_users.staff_id` for auth-backed login.

## Guardrails
- Tenant isolation: every staff read/write pins to the token's `venue`
  (`venueFromPayload`), never `?venue=` — see the `auth-tenancy` skill.
- Staff role must come from an **authenticated principal** (staff login), not from
  a request body/allowlist for privileged money actions (see SECURITY.md, Alert 5).
- Keep PCI SAQ-A: staff never handle card data; they send a pay link / QR.
- Amounts are minor units; currency defaults KES.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
