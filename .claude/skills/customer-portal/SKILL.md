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
- `db/26-loyalty-portal.sql` — `loyalty_rewards`, `reward_redemptions`, `portal_tokens`.

## Endpoints
- `POST /api/portal/token` — public; issue an opaque token for `{ venue, phone }`.
- `GET /api/portal/:token` — public; points/tier + invoices + payments + rewards.
- `POST /api/portal/:token/redeem` — public; spend points → reward code.
- `GET/POST/PATCH/DELETE /api/rewards` — **authed**; manage the catalogue.

## Conventions
- Access is via an **opaque token** (never a raw phone in the URL) to prevent
  enumeration. Production should OTP-verify before issuing a token.
- Points are integers; deduct atomically and never let a balance go negative.
- Money is minor units (KES) for display; portal is venue-scoped via the token.

## Guidelines
- Keep the portal dependency-light and resilient (a cheap phone opens it).
- Redemptions are append-only + issue a short human code the staff can honour.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
