# Global enterprise readiness review

**Review date:** 24 August 2026  
**Target:** globally deployable merchant operations platform across desktop,
phone, tablet/handheld and Android mPOS integrations.

## Executive verdict

**NO-GO for unrestricted global enterprise deployment.**

PesaSwap Merchant has a strong regional commerce core and a credible
server-authoritative foundation. It is suitable for controlled sandbox and pilot
workloads. It is not yet equivalent to an SAP/Oracle-class operating and finance
platform, and it does not yet contain a certified Android card-present mPOS SDK.

This review uses [the enterprise roadmap](GLOBAL-ENTERPRISE-ROADMAP.md) as the
release contract. A green source build is not a global-readiness decision.

## Changes completed in the first enterprise slice

### Authoritative manager membership

- Venue roles are resolved from `user_venues`, not stale `app_users.role` data.
- Venue JWTs carry `membership_version` and are checked against the database on
  every protected request.
- Role change, removal or version advance invalidates an existing token
  immediately.
- A manager can grant staff or supervisor roles but cannot grant, re-role or
  remove a manager. Only an owner can manage manager/owner peers.
- Membership changes and immutable membership events are written in one
  transaction.
- Migration 82 creates versioning triggers and append-only membership events.
- Password, OTP, Google, signup, switch, refresh and SSO issuance share the same
  membership-aware minting boundary.

**Validation:** migration 82 executed with structural assertions inside a rolled
back PostgreSQL transaction; focused login, mutation and revocation tests pass.
Deployment remains gated on applying migration 82 before the matching Worker.

### Adaptive web-device foundation

- Static and branded manifests launch `/pesaswapApp` without a portrait lock.
- The operator shell expands beyond a fixed 420px phone frame on tablets and
  desktop while preserving phone full-screen behavior.
- Operator navigation exposes selected-state semantics and 44px minimum targets.
- Shared dialog and sheet close controls use 44px targets.
- The notification and `See all` controls perform real navigation.
- The four home metrics use four columns instead of overflowing a three-column
  grid.
- The service worker precaches the real `/offline.html` asset and never serves a
  cached sensitive navigation.
- Playwright now includes desktop, iPhone, Android handheld and Android tablet
  profiles.

This is responsive web/PWA support. It is **not** native Android mPOS or
card-present certification.

## Core-function review

| Capability                        | Current result                                     | Global enterprise gate                                                          |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Tenant isolation                  | Strong central route/venue policy                  | Complete all-tier negative matrix and migration parity                          |
| Roles and manager persona         | Membership-authoritative in source                 | Deploy migration 82 everywhere; verify immediate live revocation                |
| Approvals / segregation of duties | Mostly action-specific or absent                   | Reusable maker-checker kernel and thresholds                                    |
| Orders and KDS                    | Server-backed core exists                          | Authoritative totals, strict state machine, no local fallback authority         |
| Floor and tables                  | Mixed server/browser projections                   | Server-owned sections, assignments, transfer and event history                  |
| Payments                          | Strong intents, ledger, refunds and outbox         | Scoped fail-closed idempotency, authenticated status and complete lifecycle     |
| POS                               | Connector/tender framework and inert Toast adapter | Apply migrations, live provider pilot, compatibility and recovery certification |
| End of Service                    | Internal reports and settlement estimate           | Persistent all-channel close, blockers and line-level discrepancy analysis      |
| Tips                              | Attribution/distribution model exists              | Repair pool mutation conflict; independent payout evidence/approval             |
| Accounting                        | Balanced minor-unit subledger                      | Legal entities/books, database posting constraints, currency/FX/tax dimensions  |
| Bank reconciliation               | Provider evidence matching prototype               | Authenticated statements, independent bank match, suspense and approvals        |
| Invoicing                         | Server-backed invoices, links and recurring        | Global tax/currency, lifecycle contract and ERP export manifests                |
| CRM/loyalty                       | Useful venue-scoped customer tools                 | Cross-venue identity policy, consent/data residency and global localisation     |
| Analytics                         | Operational dashboards                             | POS-derived covers/adoption, dimensions, scheduled digest and governed metrics  |
| Audit                             | Strong financial facts; membership events added    | One complete operator event stream with signed exports                          |
| Accessibility                     | Static lint ratchet                                | axe, contrast, keyboard, zoom, NVDA/VoiceOver/TalkBack evidence                 |
| Localisation                      | Timezone foundation                                | Locale, language, RTL, ISO currency exponents and jurisdictional tax            |
| Offline                           | Safe payment drafts                                | Inspect/retry UX, encrypted native recovery, managed minimum version            |
| Observability                     | Request IDs and error capture                      | SLO dashboards, connector/device metrics, trace propagation and alert runbooks  |
| DR/security operations            | Partial deployment controls                        | Tested backup/restore, RPO/RTO, rotation, residency and penetration evidence    |

## Device matrix

| Surface                   | Status     | What works                                                     | What is still required                                                          |
| ------------------------- | ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Desktop back office       | 🟡 Partial | Owner/manager dashboard, reports, configuration and accounting | Dense bulk workflows, keyboard certification, accessibility and global locale   |
| Mobile browser/PWA        | 🟡 Partial | Installable operator and guest flows, QR, push, safe areas     | Full offline recovery, screen-reader/contrast testing, minimum-version policy   |
| Tablet/handheld PWA       | 🟡 Partial | Adaptive shell and Android browser profile added               | Split-pane operational layouts, landscape workflow certification, peripherals   |
| Android checkout SDK      | 🔴 Gap     | Server payment APIs can become its backend                     | Stable `/api/v1`, enrollment, Kotlin modules, encrypted recovery and sample app |
| Android card-present mPOS | 🔴 Gap     | No card-present component exists                               | Certified provider SDK, device attestation, terminal sessions, EMV/PCI evidence |
| Restaurant POS connector  | 🟡 Partial | Check normalization, Toast adapter, tender outbox and recovery | Credentials, migrations, supervised provider pilot and refund/void runbook      |

## Android mPOS boundary

The current PesaSwap hosted card and M-Pesa paths are card-not-present. The POS
connector records payment outcomes back onto restaurant checks. Neither is a
card-present terminal.

A globally valid Android mPOS solution requires:

1. Owner/manager pairing and managed device identity.
2. Android Keystore proof of possession and attestation policy.
3. Short-lived venue/device/operator tokens with immediate remote revocation.
4. Server-authoritative terminal sessions with monotonic events and an explicit
   `unknown` recovery state.
5. A provider-certified EMV/PCI MPoC or CPoC Android SDK for NFC/chip/PIN,
   firmware and key management.
6. No PAN, PIN, track data, EMV TLV or cryptogram in Merchant APIs, logs or local
   storage.
7. Kotlin modules for core transport, checkout, certified terminal bridge,
   receipts and testing.
8. Process-death, network-loss, duplicate-callback and no-double-charge tests.

Until those gates pass, the product must say **Android checkout/PWA**, not mPOS.

## Highest-risk open findings

1. Global API idempotency is not yet partner/venue/operation scoped with request
   hashes and fail-closed uncertainty.
2. Payment status retrieval does not yet have a generation-grade resource-token
   contract.
3. Manager and operational actions lack a reusable approval/maker-checker model.
4. End of Service and line-level discrepancy reporting remain the flagship
   operational gap.
5. Unverified payout evidence can reach reconciliation paths that need an
   independent bank-proof safety gate.
6. Finance is KES-first and has no legal-entity, functional-currency, FX or tax
   jurisdiction model.
7. KDS/floor and some workforce surfaces still mix server state with browser
   presentation state.
8. No native Android SDK, managed device control plane or terminal-session domain
   exists.
9. Accessibility is lint-enforced but not runtime or manually certified.
10. Deployment/migration parity across dev, prod-local, sandbox and production is
    not yet consistently evidenced.

## Release gates

The platform is fit for a global solution only when all are true:

- No P0/P1 security, financial-integrity or tenancy finding remains.
- One multi-venue, multi-currency period closes with zero unexplained difference.
- Every privileged command has current membership, capability, audit and approval
  evidence where policy requires it.
- Desktop, phone and tablet/handheld critical journeys pass automated and manual
  accessibility/device testing.
- Android SDK recovery proves no duplicate charge under process death or network
  uncertainty.
- Card-present operation has independent provider and compliance certification.
- All migrations and one identifiable build are verified on every runtime tier.
- Backup/restore, rollback, key rotation and disaster recovery are demonstrated.
- Versioned APIs and SDKs have compatibility, deprecation and support policies.

## Next implementation package

Proceed with **Phase 0.2: approval kernel and operator audit**, then the first
versioned Payment Session Create/Retrieve API. Do not start a terminal SDK before
those authority and idempotency boundaries exist.

## Validation evidence for this review

- TypeScript typecheck: passed.
- Unit tests: 112 files, 1,012 tests passed.
- Lint/accessibility ratchet: 0 errors, 129 tracked warnings remain.
- Production build: passed.
- Migration 82: structure, version bump and append-only behavior executed against
  PostgreSQL inside a rolled-back transaction.
- Browser tests: desktop Chromium, Android handheld and Android tablet profiles
  passed the operator-shell overflow and 44px-target assertions.
- Visual review artifacts: `test-results/global-device-review/`.
- Native Android, certified terminal, NVDA/VoiceOver/TalkBack, contrast,
  multi-currency close, bank matching, DR and production-tier parity remain
  unverified and therefore block a global GO decision.
