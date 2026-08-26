---
name: production-go-live
description: >-
  Coordinate production readiness across personas, security, finance, APIs,
  SDKs, devices, accessibility, localization, operations, recovery, and all
  runtime tiers. Use when a task mentions go-live, launch readiness, enterprise
  readiness, production capability, release gates, certification, evidence
  packs, global standard, SAP/Oracle parity, or whether the application is ready.
---

# Production go-live

Treat go-live as an evidence-backed business decision, not a synonym for a green
build or a successful deploy.

## Ground truth

- `docs/PRODUCTION-GO-LIVE-CAPABILITIES.md` is the cross-domain contract.
- `docs/GLOBAL-ENTERPRISE-ROADMAP.md` sets dependencies and delivery order.
- `docs/GLOBAL-READINESS-REVIEW.md` records the current GO/NO-GO verdict.
- `.claude/DEPLOYMENT-PARITY.md` owns executable environment verification.

Domain skills remain authoritative for implementation details. This skill owns
the integration of their evidence and prevents a narrow success from being
reported as whole-product readiness.

## Evidence states

Use only the contract states: **designed**, **source complete**, **environment
verified**, **production ready**, and **certified**. Name the environment,
device, provider, artifact, migration set, and evidence for every assertion.

## Approach

1. Resolve the release scope to personas, capabilities, data, integrations,
   devices, jurisdictions, runtime tiers, and external approvals.
2. Read the relevant domain skills and delegate focused implementation or review
   rather than substituting a generic checklist for domain expertise.
3. Build a blocker register with owner, dependency, evidence state, severity,
   target, and customer-safe limitation language.
4. Require positive, denial, duplicate, concurrency, timeout, partial-failure,
   recovery, audit, and reconciliation evidence for every critical journey.
5. Verify the immutable artifact and migration set through dev, prod-local,
   sandbox, and production using risk-appropriate smoke or canary procedures.
6. Update the readiness review and roadmap only from retained evidence.

## Constraints

- Do not claim production readiness from source tests, screenshots, a single
  browser, one runtime, simulated payments, or an unapplied migration.
- Do not conflate PWA, Android SDK, mPOS, POS integration, or payment-provider
  support. Each has a distinct trust and certification boundary.
- Do not waive unresolved tenant isolation, money integrity, role elevation,
  recovery, accessibility barrier, or required external certification.
- Never deploy, migrate production data, or run live-money probes unless the
  user explicitly requests it and the relevant runbook and approval are present.

## Release decision output

Report: decision and scope; evidence state by domain; persona and device results;
four-runtime results; security/finance/operations approvals; blockers; rollback
or compensating plan; named operator actions; and the next dependency in order.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: production-go-live -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- The cross-domain release decision: capability scope, persona journeys, trust boundaries, dependencies, risk, evidence state, blockers, owners, and honest customer-safe claims.
- The release evidence pack across source, migrations, security, finance, API/SDK, devices, accessibility, localization, operations, recovery, all four runtime tiers, and external certification.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
