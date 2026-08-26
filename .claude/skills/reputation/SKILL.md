---
name: reputation
description: >-
  Maintain Reputation & Guest Insights — reviews, reputation, ratings, Google
  review, review reply, guest insights, feedback, food/service/ambience/value,
  NPS, and sentiment.
---

# Reputation & Guest Insights

The "payment = start of the relationship" reputation loop. After payment,
customers are prompted to rate the experience (overall + food/service/ambience/
value + comment), attributed to the serving staff and payment. Owners reply
manually or via AI; negative unanswered reviews surface as needs-attention
alerts. Benchmarked against SundayApp Online Reputation + Guest Insights.

## Key files

- `src/lib/reviews.ts` — pure helpers: `summarizeReviews` (average, 5→1
  distribution, food/service/ambience/value averages, response rate,
  `needsAttention`), `clampRating`, `isNegative`, `buildReplyPrompt`.
- `src/api/reviews.ts` — public capture, gated list/stats, gated manual/AI reply.
- `db/32-reviews.sql` — `reviews` table: venue, 1–5 ratings/dimensions, comment,
  customer/staff/payment attribution, source, response, `response_ai`,
  `responded_at`. Ratings are 1–5 integers, not minor units.
- `src/server.ts` — registered as `handleReviewsRoute`.
- `src/routes/dashboard/reviews.tsx` — dashboard surface. Post-pay capture prompt
  lives in the pay/table flows.

## Endpoints

- `POST /api/reviews` — **public** capture from pay/table/QR pages:
  `{rating, food, service, ambience, value, comment, customerName, phone,
staffId, paymentId, source}`. Venue is resolved via `resolveVenue`.
- `GET /api/reviews` — **gated** (`requireAuth` + `venueFromPayload`):
  `{reviews, stats}` where `stats = summarizeReviews`.
- `POST /api/reviews/:id/reply` — **gated**. Provide `{text}` for a manual reply,
  or omit it for an AI-generated reply (`aiChat` + `buildReplyPrompt`), stored
  with `response_ai=true`.

## Conventions

- Public capture must never be gated; list/reply must be gated and venue-scoped.
- Gated routes use `requireAuth` + `venueFromPayload`; venue comes from the JWT
  claim, never `body`/query.
- Ratings are 1–5 (`clampRating`); the four dimensions are optional 1–5 values.
- AI replies use `aiChat` (LLM-agnostic, provider fallback) and are best-effort.
- Negative means rating `<= 2`; unanswered negative reviews are the instant
  negative-feedback alert surface (`stats.needsAttention`).

## Guidelines

- Keep helpers pure and unit-testable; DB/network work stays in the API route.
- Preserve staff/payment attribution when adding capture sources.
- Do not let AI reply failures overwrite manual text or block non-AI flows.
- Keep dashboard stats aligned with `summarizeReviews`, not duplicated math.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: reputation -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Consent-aware review and feedback capture, food/service/ambience/value dimensions, NPS where valid, provider linkage, moderation, alerts, response approval, publication state, and audit history.
- Traceable sentiment and generated response suggestions with source text, confidence, human control, privacy, platform-policy compliance, and no fabricated external review state.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
