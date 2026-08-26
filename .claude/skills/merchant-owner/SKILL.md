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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: merchant-owner -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- The complete owner lifecycle: organisation and venue setup, business and settlement configuration, vertical/tier choice, manager invitation and revocation, channels, brand, oversight, export, handover, and closure.
- Owner-only control over manager/owner authority and other material configuration, with maker-checker approval where required, immutable audit, support recovery, and multi-store visibility.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
