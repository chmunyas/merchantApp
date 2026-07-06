---
name: merchant-owner
description: >-
  The business owner (role `merchant`) who owns a venue and has full control of
  the back office — menu, bookings, invoicing, payments, CRM, campaigns,
  knowledge base, analytics, branding, staff, and plan/billing. Use for tasks
  about the owner experience, self-onboarding, what the account owner can do, or
  venue-wide configuration.
---

# Merchant (owner)

The account owner. Self-onboards (`/api/auth/signup` → venue + `app_users` row,
role `merchant`, venue claim) and has full authority over their **own** venue.

## What the owner can do (maps to the domain skills)
- **Storefront:** menu/catalogue, bookings/enquiries, knowledge base (FAQs).
- **Money:** invoicing + pay links, payments/refunds, tips config, plan/limits.
- **Growth:** campaigns/automations, CRM & loyalty, analytics dashboards.
- **Channels:** connect WhatsApp/Telegram/etc. + the omnichannel AI agent.
- **Team:** staff directory (`/api/staff`), roles/permissions (RBAC).
- **Brand:** logo/colour/name (`/api/branding`); under a reseller, inherits the
  bank co-brand.

## RBAC & tenancy
- Role `merchant`; token carries `venue` (+ `org` when under a reseller).
- Every read/write is pinned to the owner's `venue` (`venueFromPayload`) — an
  owner can never reach another tenant.
- The owner may delegate `manager`/`supervisor`/`staff` scopes (see those skills);
  platform-admin actions are NOT available to an owner.

## Guardrails
- Keep tenant isolation; never trust `?venue=` for a merchant token.
- PCI SAQ-A (pay links, no card data). Amounts minor units, KES default.
- See `auth-tenancy`, `payments`, `invoicing`, `menu-catalogue`, `analytics`.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
