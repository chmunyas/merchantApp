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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: customer-value -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Explainable and reproducible RFM, lifetime-value, churn-risk, cohort, and win-back outputs with defined inputs, windows, timezone, currency, freshness, and confidence.
- Consent-aware activation, role-appropriate detail, source-record drill-through, model/version traceability, and safeguards against treating predictions as facts.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
