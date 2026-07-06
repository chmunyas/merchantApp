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
- `src/api/agentcommerce.ts` — `GET /api/agent/catalog`, `POST /api/agent/checkout`.
- `src/api/a2a.ts` — the discovery card (`/.well-known/agent-card.json`) + NL endpoint.
- `src/api/payments.ts` / `src/api/invoices.ts` — the pay-link mechanism reused for intents.

## Endpoints
- `GET /api/agent/catalog?venue=` — **public**; machine-readable menu + checkout hint.
- `POST /api/agent/checkout` — create a payment intent → { intentId, amount, payUrl }.
- `GET /.well-known/agent-card.json` — capabilities incl. `get_catalog` + `checkout`.

## Conventions
- Checkout reuses the existing public pay URL (`/pay?i=` → `/api/invoices/payinfo`)
  — never mint a new payment rail.
- Trusted agents send `x-api-key: $A2A_API_KEY`; untrusted callers may be amount-capped.
- Amounts are minor units, KES; catalogue + checkout are venue-scoped.

## Guidelines
- Keep the catalogue stable + self-describing (ids, prices, currency, checkout endpoint).
- Return an intent id so an agent can correlate to the eventual payment.
- Never weaken the A2A staff-scope key gate to enable checkout.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
