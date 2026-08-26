---
name: customer-portal
description: >-
  A token-based customer self-service portal + loyalty rewards redemption — the
  retention loop. Use when a task mentions the customer portal, /me/:token, order
  or invoice history for a customer, loyalty rewards, points redemption, or the
  rewards catalogue.
---

# Customer portal & rewards

Closes the "payment → data → repurchase" loop: a customer opens a branded portal
(via an opaque token, no login), sees their points/tier + invoices + payment
history, and redeems loyalty rewards. The merchant curates the rewards
catalogue. Alipay's "points mall" + ERPNext's customer portal, localized.

## Key files

- `src/api/portal.ts` — public portal (`/api/portal/*`) + authed rewards CRUD
  (`/api/rewards`).
- `src/routes/me.$token.tsx` — the public, branded portal page.
- `src/routes/dashboard/rewards.tsx` — merchant rewards catalogue editor.
- `src/lib/loyalty.ts` — tier ladder + `tierProgress`, `tierBenefits`, `pointsExpiry`.
- `db/26-loyalty-portal.sql` — `loyalty_rewards`, `reward_redemptions`, `portal_tokens`.

## Endpoints

- `POST /api/portal/token` — request a venue/phone-bound OTP challenge.
- `POST /api/portal/token/verify` — consume the isolated OTP and rotate an
  expiring, hash-at-rest portal link.
- `GET /api/portal/:token` — public; points/tier + invoices + payments + rewards.
- `POST /api/portal/:token/redeem` — public; spend points → reward code.
- `POST /api/portal/:token/revoke` — self-revoke the active portal link.
- `GET/POST/PATCH/DELETE /api/rewards` — **authed**; manage the catalogue.

## Conventions

- Access is via a random 256-bit opaque token (never a raw phone in the URL).
  Only its SHA-256 hash is stored; issuance requires OTP verification, expires in
  30 days, and rotates every older link for that venue/phone.
- Points are integers; deduct atomically and never let a balance go negative.
- Money is minor units (KES) for display; portal is venue-scoped via the token.
- The portal returns **tier progress** (points to next tier), **tier benefits**
  (perks + unlock-next) and a **points-expiry nudge**; pay-success (`pay.tsx`
  `SuccessState`) shows a QR to `/me/:token` (receipt-as-portal).

## Guidelines

- Keep the portal dependency-light and resilient (a cheap phone opens it).
- Redemptions are append-only + issue a short human code the staff can honour.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: customer-portal -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Verified, revocable customer access to the correct venue-scoped orders, invoices, receipts, profile, consent, loyalty balance, rewards, redemptions, and support path.
- Protection against token leakage, enumeration, replay, cross-customer access, duplicate redemption, stale balances, and unsafe account recovery.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
