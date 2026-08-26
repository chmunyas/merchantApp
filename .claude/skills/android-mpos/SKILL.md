---
name: android-mpos
description: >-
  Build and validate the Android checkout SDK, managed handheld support, payment
  terminal integration, and certified card-present mPOS boundary. Use for Android
  SDK, mobile POS, mPOS, PDQ, payment terminal, Tap to Pay, NFC, EMV, contactless,
  PCI PTS, device enrollment, attestation, or Android handheld checkout.
---

# Android checkout and mPOS

This domain has two deliverables with different trust boundaries:

1. An Android checkout SDK that consumes the versioned PesaSwap Merchant API.
2. A card-present mPOS product that additionally requires approved hardware,
   kernels, keys, acquiring integration, certification, operations, and support.

The repository currently has an adaptive PWA, not either completed deliverable.
Do not call a web wrapper or card-not-present SDK "mPOS."

## Android SDK contract

- Kotlin-first coroutine APIs, cancellation, explicit timeout and retry behavior,
  idempotency keys, sealed unknown-safe results, stable error codes, and no
  client authority over venue or amount.
- Generated or contract-tested models from the versioned API; semantic versioning,
  compatibility and deprecation policy; reproducible build and signed release.
- Keystore-backed credentials, no secrets or payment data in logs, certificate
  and network policy, dependency scanning, telemetry with correlation ids, and
  remote minimum-version enforcement.
- Sample application and tests for create, confirm, status, cancel, reversal,
  timeout, process death, offline/resume, duplicate tap, receipt, and support
  diagnostics against an isolated sandbox.

## Managed device contract

Device enrollment binds organisation, venue, terminal, allowed functions, app
version, credential version, and attestation. Rotation, revocation, lost-device
response, session lock, remote configuration, inventory, health, and audit are
part of the product rather than installation notes.

## Card-present mPOS gate

Before any mPOS claim, retain evidence for the chosen PCI PTS terminal or approved
Tap-to-Pay path, EMV/contactless kernel and scheme/acquirer certification, secure
key injection and rotation, attestation, transaction counters, online/offline
rules, reversal/advice and duplicate recovery, refunds, receipts, settlement,
terminal estate management, compatibility, incident response, and field support.

Follow Phase 3 of `docs/GLOBAL-ENTERPRISE-ROADMAP.md`. Provider and certification
requirements must come from current official sources; mark unknowns as blockers.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: android-mpos -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- A versioned Android checkout SDK with coroutine APIs, unknown-safe results, cancellation, timeout and retry semantics, secure credential storage, telemetry hooks, contract tests, and a maintained sample application.
- The separate card-present mPOS boundary: approved PCI PTS hardware, EMV/contactless and acquirer certification, key handling, attestation, terminal lifecycle, reversal and recovery, receipt rules, compatibility evidence, and field support.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
