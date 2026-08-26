---
name: agentic-checkout
description: >-
  AI-Collect — let external AI agents discover a venue's catalogue and initiate a
  checkout (payment intent / pay link) over A2A. Use for tasks about the machine-
  readable catalogue, /api/agent/*, agent-payable checkout, or the A2A discovery card.
---

# Agentic checkout (AI-Collect)

Designs the merchant for the agentic-commerce era: any AI agent on the internet
can read the catalogue and start a payment. The Alipay "AI Collect" analog, built
on the existing A2A surface — payment becomes infrastructure an agent can
understand, invoke and trust.

## Key files

- `src/api/agentcommerce.ts` — `GET /api/agent/catalog`, `POST /api/agent/checkout`
  (incl. **split**), `POST /api/agent/booking`, `POST /api/agent/intent`,
  `POST /api/agent/intent/verify`.
- `src/api/a2a.ts` — the discovery card (`/.well-known/agent-card.json`) + NL endpoint.
- `src/lib/agent-intent.ts` — Verifiable Intent: `signIntent`/`verifyIntent` (HMAC-SHA256).
- `src/lib/split-bill.ts` — `splitShares(total,{parties|amounts})` (equal or custom, sums exactly).
- `src/api/payments.ts` / `src/api/invoices.ts` / `src/lib/pay-links.ts` — the pay-link mechanism reused for intents + split shares.

## Endpoints

- `GET /api/agent/catalog?venue=` — **public**; machine-readable menu + checkout hint.
- `POST /api/agent/checkout` — venue-bound PAT with `agent:invoke`,
  `payments:write`, and `menu:read`; accepts catalogue IDs + quantities and
  creates a payment intent → { intentId, amount, payUrl,
  **intent** (signed payload + signature) }.
  - **Split:** pass `split: { parties: N }` or `split: { amounts: [...] }` → mints one
    server-bound pay link per share (`kind:"split"`) that sum EXACTLY to the total →
    `{ amount, split: { parties, shares:[{index, amount, payUrl}] }, intent }`.
- `POST /api/agent/booking` — **confirmed** table reservation (capacity-checked):
  `{ venue, name, phone?, covers, date (YYYY-MM-DD), time (HH:MM) }` →
  `{ bookingId, status:"confirmed", ... }` (409 with `available` when full).
- `POST /api/agent/intent` — create + **sign** a standalone spending intent → { id, payload, signature }.
- `POST /api/agent/intent/verify` — `{ payload, signature }` → `{ valid }` (constant-time HMAC check).
- `GET /.well-known/agent-card.json` — capabilities incl. `get_catalog`, `checkout`,
  `split_checkout`, `book`.

## Verifiable Intent Framework

- Every checkout is signed (HMAC-SHA256 over a canonical payload) so the merchant / a
  relying bank can cryptographically confirm exactly what the agent authorised.
- Signing secret: `AGENT_INTENT_SECRET` → falls back to `JWT_SECRET` → dev default.
  Set `AGENT_INTENT_SECRET` as a Worker secret in production.
- Signed intents are persisted to the `agent_intents` table (`db/35`).

## Conventions

- Checkout reuses the existing public pay URL (`/pay?i=` → `/api/invoices/payinfo`)
  — never mint a new payment rail.
- Commerce writes require a scoped PAT; shared keys and body-selected roles/venues
  are not authorization. Standalone signed intents reference a same-tenant order
  or invoice rather than accepting an arbitrary amount.
- Amounts are minor units, KES; catalogue + checkout are venue-scoped.

## Guidelines

- Keep the catalogue stable + self-describing (ids, prices, currency, checkout endpoint).
- Return an intent id so an agent can correlate to the eventual payment.
- Never weaken the A2A staff-scope key gate to enable checkout.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: agentic-checkout -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Versioned, scoped machine discovery and checkout contracts that bind price, venue, currency, order, caller, expiry, and idempotency on the server.
- Agent-safe confirmation, payment recovery, receipt, audit, rate-limit, sandbox, and human-escalation behavior without granting UI-equivalent ambient authority.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
