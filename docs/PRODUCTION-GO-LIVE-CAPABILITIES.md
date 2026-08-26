# Production Go-Live Capability Contract

**Contract ID:** `PRODUCTION_GO_LIVE_CONTRACT: v1`

This document defines what the PesaSwap Merchant App must be capable of before
it is represented as production-ready. It is a target contract, not a statement
that every capability exists today.

The current decision remains the one recorded in
[GLOBAL-READINESS-REVIEW.md](./GLOBAL-READINESS-REVIEW.md). Delivery order and
dependencies are governed by
[GLOBAL-ENTERPRISE-ROADMAP.md](./GLOBAL-ENTERPRISE-ROADMAP.md). Domain roadmaps
may add stricter criteria, but they may not weaken this contract.

## How to state capability truth

Use one of these evidence states. Do not collapse them into "done."

| State                    | Meaning                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| **Designed**             | Acceptance criteria and trust boundaries are documented.                                  |
| **Source complete**      | Code, migrations, tests, and operator instructions exist in the repository.               |
| **Environment verified** | The exact build and migration set passed in a named runtime with retained evidence.       |
| **Production ready**     | All applicable gates in this contract passed in all required runtimes and device classes. |
| **Certified**            | An external scheme, acquirer, assessor, or platform has issued required approval.         |

Never infer a later state from an earlier one. In particular, a responsive PWA
is not an Android SDK, a card-not-present SDK is not mPOS, and a provider sandbox
success is not card-present certification.

## People and complete journeys

Production go-live means each person can finish their normal journey without
shared credentials, browser-only business records, hidden manual repair, or
privilege outside their role.

| Person                                  | Required start-to-finish outcome                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform operator and support**       | Provision and suspend tenants, set paid tiers, configure supported identity and provider settings, inspect health, coordinate incidents and recovery, and perform tenant-safe support through time-bounded, audited access.                                                                                                                                                             |
| **Merchant owner**                      | Establish the organisation and venues, complete business and settlement configuration, invite or revoke managers, choose vertical and entitled capabilities, configure brand and channels, oversee operations and finance, export data, and close or hand over the account. Only an owner or platform authority may grant owner or manager authority.                                   |
| **Manager**                             | Run a venue below the owner: schedule staff, configure operational menus or catalogues, approve bounded discounts, voids and refunds, manage inventory and suppliers, oversee bookings, orders, inboxes and campaigns, reconcile the shift or trading day, review labour and tips, and escalate exceptions. A manager must not grant peer or owner authority or bypass approval limits. |
| **Supervisor**                          | Run an assigned shift: oversee floor and inbox work, assign tables or sections, approve only configured low-value exceptions, reassign or escalate conversations, and produce a shift handover report.                                                                                                                                                                                  |
| **Staff, cashier, server and kitchen**  | Authenticate as an individual, work only assigned venues and functions, take or fulfil orders, send a bill or payment request, update kitchen or service state, attribute tips, and complete handover without seeing restricted costs, margins, settlement secrets, or owner controls.                                                                                                  |
| **Finance and auditor**                 | Trace every monetary outcome from source document through payment, refund, fee, settlement and balanced journal; manage invoices, tax, periods, exceptions and exports; and reproduce reports without editing history.                                                                                                                                                                  |
| **Customer or guest**                   | Discover the venue, consent to communication, browse an accurate menu or catalogue, book or order, split and tip, pay a server-bound amount, receive status and a receipt, earn or redeem loyalty, use self-service, and reach a human when automation cannot finish safely.                                                                                                            |
| **Partner developer or external agent** | Discover versioned contracts, obtain scoped credentials, build and test in an isolated sandbox, use idempotent APIs and signed webhooks, observe rate and error semantics, complete certification where required, and migrate without unannounced breaking changes.                                                                                                                     |

## Required business capability

The enabled vertical and paid tier decide which modules a venue receives. Any
module offered for sale must be an end-to-end server-authoritative capability,
not a navigation label or local demo.

| Domain                            | Production capability                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity and tenancy**          | Revocable venue membership, least-privilege RBAC and scopes, secure staff and customer credentials, membership-version session invalidation, MFA or federated identity where required, rate limits, device/session controls, and immutable security events. Every query and mutation is tenant-scoped.     |
| **Organisation and stores**       | Organisation-to-venue hierarchy, explicit per-venue membership, controlled role changes, consistent policy across UI and API, tier enforcement, and multi-store aggregation without cross-tenant leakage.                                                                                                  |
| **Menu, catalogue and inventory** | Versioned products or menu items, categories, options, prices, availability, dietary data, SKU/barcode lookup, stock movements, suppliers, purchase orders and auditable adjustments. Dynamic and POS-synchronised data has explicit source and conflict rules.                                            |
| **Orders, bookings and service**  | Server-authoritative bookings, tables, orders and kitchen tickets with validated state transitions, assignment, hold/fire/serve, split/transfer, fulfilment, cancellation and recovery. Concurrent devices see one state.                                                                                  |
| **Retail counter**                | Server-backed catalogue lookup and sales, idempotent checkout, stock movement, payment linkage, receipts, returns/void controls, shift/cash controls, supplier and credit ledgers, and multi-store reporting. Business records do not depend on `localStorage`.                                            |
| **Payments**                      | Server-bound payment intents and amounts, idempotent create/confirm/capture, provider-authenticated status, signed or pull-reconciled webhooks, tips, split payments, pay links, refunds, disputes, reversals and receipts. PAN and sensitive authentication data never enter application logs or storage. |
| **Finance**                       | Immutable payment and settlement ledgers, fee and net reconciliation, balanced double-entry posting, invoice and tax lifecycle, accounts receivable, period locks, approvals, compensating corrections, trial balance, income statement, balance sheet and audit-grade exports.                            |
| **Customers and loyalty**         | Deduplicated tenant-scoped contacts, consent and suppression, loyalty earn/redeem with an immutable points ledger, customer portal credentials, order/invoice/receipt history, segmentation and explainable retention measures.                                                                            |
| **Channels and automation**       | One consent-aware inbound/outbound pipeline across enabled channels, verified provider callbacks, delivery status, retry and dead-letter handling, cross-channel identity and handoff, human escalation, campaigns with suppression, and policy-bounded AI actions.                                        |
| **Reputation and intelligence**   | Traceable reviews, feedback, sentiment and responses; reproducible analytics; versioned forecasting, pricing, reorder and customer-value inputs; confidence and freshness shown where decisions are recommendations rather than facts.                                                                     |
| **Merchant copilot and A2A**      | Read actions respect the acting user's tenant and role; mutations use the same policy, validation, idempotency, approval and audit path as human UI actions; high-impact operations require preview or confirmation; external agents use scoped machine contracts.                                         |
| **Reporting and export**          | Role-appropriate operational and financial reports with explicit timezone, currency, filters, freshness and definitions; drill-through to source records; pagination and export for large data; no metric exists only as an untraceable aggregate.                                                         |

## Enterprise control plane

The product must provide controls expected of a global system of record:

- Separation of duties for identity administration, money movement, period
  close, provider configuration and support access.
- Configurable maker-checker approval for material refunds, voids, discounts,
  payouts, bank-detail changes, role elevation and accounting adjustments.
- Append-only audit events containing tenant, actor, effective principal,
  action, resource, before/after or reason, correlation id and trusted time.
- Versioned policy and configuration changes with safe defaults, effective dates,
  rollback or compensating action, and no secret values in general settings.
- Data retention, legal hold, tenant export and deletion workflows that reconcile
  privacy duties with financial-record retention.
- Reconciliation queues and financial outboxes that are idempotent, observable,
  replay-safe and recoverable after partial failure.

## API, SDK and integration contract

The browser UI is one client of the platform, not a privileged alternative.

- Public partner surfaces are versioned and described by a generated OpenAPI or
  equivalent machine contract. Compatibility and deprecation windows are explicit.
- Human sessions, personal access tokens, service principals and external agents
  have distinct, revocable credentials and least-privilege scopes.
- Mutating requests define validation, idempotency, concurrency and retry
  semantics. Errors have stable codes, correlation ids and safe messages.
- Webhooks are authenticated, replay-protected, observable, retryable and paired
  with a pull-reconciliation path for business-critical state.
- Sandbox data, credentials, provider profiles, telemetry and callbacks are
  isolated from production. Test money cannot post to production books.
- SDKs are generated or contract-tested against the same API schema and include
  unknown-safe models, timeout/cancellation behavior, retry guidance, secure
  storage rules, telemetry hooks, a sample app and a supported-version policy.

## Device contract

Core journeys must be intentionally supported on desktop, phone, tablet and
operational handheld layouts. Responsive rendering alone is insufficient.

- Touch targets, focus order, virtual keyboards, orientation, safe areas,
  camera/scanner use, intermittent connectivity, duplicate submission, resume,
  push notifications and session locking have defined behavior.
- Offline or degraded operation is permitted only for explicitly designed data.
  Financial authority, stock truth and permission changes reconcile with server
  state and never silently become browser-local authority.
- Peripheral support such as barcode scanners, receipt printers, drawers and
  payment terminals has a compatibility matrix, lifecycle ownership and a
  recoverable failure path.
- Managed devices require enrollment, tenant/venue assignment, credential
  rotation, revocation, minimum-version enforcement and audit telemetry.

### Android and mPOS boundary

An Android checkout SDK may provide card-not-present or wallet checkout against
the public API. It may be called **mPOS** only after the card-present boundary is
implemented and approved, including supported PCI PTS hardware, EMV/contactless
kernel and acquirer or scheme certification, secure key handling, device
attestation, terminal inventory, transaction reversal/recovery, receipt rules,
remote configuration and field support.

Until those controls and approvals have retained evidence, describe the product
as an adaptive PWA and planned Android checkout integration, not certified mPOS.

## Global experience requirements

- WCAG 2.2 AA is evidenced with static checks, automated browser checks, measured
  contrast, keyboard-only testing, zoom/reflow, reduced motion and real screen
  reader passes. Lint alone is not conformance evidence.
- UI, exports, receipts, notifications and APIs handle locale, Unicode, names,
  addresses, phone formats, timezones, daylight-saving transitions, currency
  minor units, exchange-rate provenance and jurisdiction-specific tax rules.
- All persisted instants are unambiguous; business dates and trading-day cutoffs
  use the venue's configured timezone and retain it in reports.
- Product language is understandable to the person using it, and destructive or
  financial actions expose consequences before confirmation.

## Operational and security requirements

- Threat modelling covers tenant isolation, privilege escalation, payment and
  webhook forgery, replay, injection, supply chain, account recovery, device loss,
  AI prompt/tool abuse and abuse of public endpoints.
- Secrets use managed secret storage and rotation. Logs and analytics exclude
  credentials, PAN, sensitive authentication data and unnecessary personal data.
- SLOs cover availability, API latency, payment confirmation, queue age and data
  freshness. Dashboards and actionable alerts use correlation ids across clients,
  APIs, providers, queues and financial events.
- Capacity, rate limits and backpressure are load-tested. Critical workflows
  degrade deliberately and recover without duplicate money or records.
- Encrypted backups, point-in-time recovery and restore drills meet documented
  RPO/RTO targets. Region or provider failures have a runbook, named owner and
  tested communication path.
- Dependency, source, container and infrastructure scanning feed a release gate;
  high-risk findings require remediation or an explicit, expiring acceptance.

## Four required runtime tiers

| Tier           | Purpose                                                                                      | Minimum evidence                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dev**        | Fast local engineering feedback.                                                             | Typecheck, lint, unit tests and focused integration/browser tests against local data.                                                                                                      |
| **Prod-local** | Production-runtime mirror using workerd and production build shape.                          | Built artifact, route/runtime behavior, migrations and integration checks against the local production mirror.                                                                             |
| **Sandbox**    | Remotely deployed, externally usable test environment with isolated data and non-live money. | Smoke and journey tests, contract/webhook checks, device evidence and migration/version evidence.                                                                                          |
| **Production** | Live tenant and live-provider environment.                                                   | Controlled smoke/canary checks, observability, migration evidence, rollback/recovery readiness and approval record. Never use destructive test transactions without an approved procedure. |

The executable environment procedure belongs in
[../.claude/DEPLOYMENT-PARITY.md](../.claude/DEPLOYMENT-PARITY.md). A check may be
marked not applicable only with a written reason and reviewer.

## Definition of production done

A capability is production-ready only when all applicable evidence is retained:

1. Acceptance criteria cover success, denial, concurrency, duplicate submission,
   provider failure, timeout, recovery and audit behavior.
2. Typecheck, lint, unit, integration and end-to-end checks pass for the changed
   risk surface. Generated contracts and database invariants are validated.
3. Authentication, role, scope, capability, tenant and sensitivity policy is
   default-deny and tested with positive and negative cases.
4. Migrations are forward-only, idempotent where required, applied in every
   relevant database and paired with rollback or compensating operational steps.
5. Financial changes prove minor-unit arithmetic, idempotency, source-to-ledger
   traceability, balanced posting, reversal and reconciliation.
6. Desktop, phone, tablet/handheld and SDK or peripheral matrices pass where the
   capability is offered; accessibility and localization checks match the surface.
7. Telemetry, alerts, dashboards, SLO impact, support diagnostics and audit events
   are present without exposing secrets or excessive personal data.
8. Load, abuse, dependency and threat checks match the blast radius; backup,
   restore and incident runbooks are exercised for critical data paths.
9. Dev, prod-local, sandbox and production evidence identifies commit, artifact,
   migration set, configuration version, tester, time and result.
10. Operator, merchant, support, partner and user documentation is updated, and
    unresolved external certification or manual action remains an explicit blocker.

## Required release evidence

Every release decision must link to an evidence pack containing:

- scope, owner, risk classification and included capability or roadmap ids;
- commit and immutable artifact identity, dependency lock and migration ledger;
- automated results plus device, accessibility and provider test records;
- security, privacy, financial-control and certification approvals as applicable;
- runtime configuration and secret-presence checks without secret values;
- deployment, smoke, observability and data-integrity results for each tier;
- rollback or compensating plan, recovery result and operator handover; and
- known limitations stated in customer-safe language with an owner and due date.

Skills and agents must report the narrow evidence they actually produced. They
must not upgrade the application, a domain, or an integration to "production
ready" on the strength of source tests alone.
