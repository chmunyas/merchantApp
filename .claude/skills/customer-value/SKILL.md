---
name: customer-value
description: >-
  Customer RFM segmentation, churn risk, lifetime value and win-back targeting.
  Use for tasks about customer segments, retention, churn, LTV, RFM, win-back, "who
  are my best/at-risk customers", or the retention dashboard.
---

# Customer value (RFM, churn & win-back)

Turns the payment ledger into a retention view: who your best customers are, who's
slipping, and where a win-back offer pays off. Customers are scored on Recency,
Frequency and Monetary value, bucketed into segments, and flagged for churn with a
simple LTV projection.

## Key files
- `src/lib/rfm.ts` — pure, unit-tested core: `scoreCustomers` (R/F/M quintiles →
  segment, churn risk, avg order value, projected annual value + win-back list).
- `src/api/rfm.ts` — `GET /api/customers/rfm` (gated manager+); registered in
  `src/server.ts` as `handleRfmRoute`.
- `src/routes/dashboard/retention.tsx` — manager-gated "Retention" page (segment
  counts, win-back targets, most-valuable customers).
- Reuses existing tables — **no migration**: `payments` (spend, authoritative) +
  `contacts` (name/tier).

## Endpoint
- `GET /api/customers/rfm` — **gated** (`requireAuth` + `roleAtLeast manager`).
  Returns `{ currency, totalCustomers, totalMonetary, segments, customers[],
  atRisk[] }`. Each customer: `{ ref (phone), name, tier, r, f, m, segment,
  churnRisk, recencyDays, frequency, monetary, avgOrderValue, predictedAnnualValue }`.

## Conventions
- **Source of truth is `payments`**, aggregated by `metadata->>'customer_phone'`
  (the loyalty key `recordLedger` accrues on) — NOT `contacts.total_spent`, which
  isn't updated on payment. `contacts` is joined only for name/tier.
- Monetary is whole KES (payments are minor units → ÷100). Only succeeded, non-refund
  payments with a phone count; anonymous walk-ins are excluded.
- Segments from R/F: Champions, Loyal, Promising, At risk, Lost, Needs attention.
- Churn risk compares recency to the customer's own cadence
  (`tenure/(frequency-1)`): a repeat buyer gone quiet is "high".
- LTV only annualises once `frequency >= 2` (tenure floored at 30 days) so a brand-new
  one-off customer isn't projected into a huge number.
- Win-back targets = churning customers (risk != low), highest value first.

## Guidelines
- Keep the scoring math in the pure lib (testable); DB aggregation stays in the route.
- Gate to manager+ — it exposes customer spend + PII (phone).
- Win-back list is the hook for a campaign (see the campaigns-automations skill); this
  surface identifies targets, it doesn't send.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
