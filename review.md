# Merchant App Production-Readiness Review and Remediation Plan

**Review date:** 2026-08-22  
**Decision:** **NO-GO for unrestricted production money movement or customer PII**  
**Implementation rule:** complete phases in order; a later phase cannot be declared complete while an earlier gate is failing.

## Executive assessment

The merchant app is a strong and unusually broad product prototype. Its QR-to-order-to-pay journey, multi-tenant data model, payment-provider integration, accounting primitives, customer retention features, and Cloudflare/PostgreSQL architecture provide a credible foundation. The implementation is not yet safe for unrestricted live use because several deployed trust boundaries are open and financial side effects are not consistently atomic or replay-safe.

Approximate assessment:

| Area | Score | Assessment |
| --- | ---: | --- |
| Product vision | 8/10 | Cohesive proposition, but breadth exceeds operational depth |
| Customer experience | 7/10 | Strong mobile-first journey and context continuity |
| Domain coverage | 8/10 | Broad payments, orders, accounting, CRM, loyalty, and channel coverage |
| Architecture | 5/10 | Good edge/PostgreSQL foundation; dual state models and large handlers add risk |
| Security and privacy | 1/10 | Multiple independently exploitable production trust failures |
| Payments integrity | 3/10 | Good provider breadth; weak authority and transactional guarantees |
| Accounting and reconciliation | 4/10 | Good journal primitives; incomplete source-event integrity |
| Operations and compliance | 3/10 | Delivery, settlement, consent, and offline guarantees are overstated |
| Testing | 6/10 | Good unit baseline; insufficient adversarial and end-to-end verification |
| Production readiness | **2/10** | **No-go until all P0 gates pass** |

## Strengths to preserve

- Cohesive scan → order → split-pay → tip → loyalty → receipt journey.
- Broad, normalized domain schema covering payments, orders, disputes, commissions, tips, accounting, inventory, and retention.
- Proper JWT tenant pinning for real non-admin sessions.
- Opaque, expiring server-bound QR and pay-link tokens.
- Balanced double-entry primitives and idempotent journal source keys.
- Durable payment-create idempotency and payment-event tracking foundations.
- Appropriate Cloudflare Workers, Hyperdrive, PostgreSQL, and Durable Object building blocks.
- Baseline validation passed at review time: TypeScript, production build, and 439 unit tests across 66 files.

## Verified critical findings

### P0 — block unrestricted production

1. **Production anonymous merchant access.** `AUTH_REQUIRE_LOGIN=0` permits `/api/auth/session` to mint merchant JWTs without credentials.
2. **Production OTP disclosure.** `AUTH_OTP_DEBUG=1` returns the valid OTP in an API response.
3. **Unauthenticated live refunds.** `/api/refunds` reaches the provider without actor authentication, role authorization, or durable database over-refund enforcement.
4. **Unsafe staff PIN authentication.** PINs are plaintext, globally unique, predictable, and not protected by a dedicated server-side attempt limit.
5. **Unverified customer portal ownership.** A venue and phone number are sufficient to mint a non-expiring portal token exposing invoices, payments, loyalty, and reward redemption.
6. **Client-priced public QR orders.** The server persists caller-provided item names and prices instead of resolving stable menu item IDs and authoritative prices.
7. **Client-controlled payment metadata.** Caller metadata can influence venue, order/invoice/pay-link settlement, tip attribution, and subscription activation.
8. **Weak messaging ingress.** WhatsApp bridge/webhook verification is conditional, bridge controls and simulators are insufficiently protected, and sender phone allowlists can become an authorization boundary.
9. **Non-atomic financial completion.** Payment persistence, invoice settlement, journals, COGS, commissions, subscriptions, loyalty, order closure, and pay-link closure are separate best-effort operations; first-success detection is race-prone.
10. **Public business/customer data.** Enquiry reads, AI memory, push subscriptions/latest notification, and selected campaign/sequence reads are insufficiently gated.

### P1 — required before controlled scale-up

- Replace endpoint-only authentication with default-deny action-level RBAC.
- Make invoice issue, payment, overpayment handling, void/reversal, and delivery ordering transactionally correct.
- Reverse all affected balances and liabilities on full/partial refunds.
- Rename internal estimated batching to reconciliation estimates until provider payout statements are imported and matched.
- Implement distinct tip-allocation rules and non-overlapping allocation periods.
- Prevent cross-currency aggregation or introduce explicit FX conversion.
- Require trusted, scoped agents and server-authoritative catalogue items for agent commerce.
- Enforce affirmative consent, channel windows/templates, truthful provider delivery states, and race-safe sequence claiming.
- Remove PII from public/payloadless push notification retrieval.
- Replace last-write-wins localStorage/PostgreSQL blob mirroring with versioned optimistic concurrency, then normalize remaining operational state.

### P2 — product and engineering debt

- Correct product claims for AI, settlement, saved methods, receipt delivery, audit chaining, and offline operation.
- Consolidate legacy/new product surfaces and stale documentation.
- Replace the long manual handler chain with declarative route policy metadata.
- Split payment and merchant-dashboard monoliths by domain boundary.
- Reduce large client chunks and validate fixed mobile checkout layouts.
- Add accessibility, WebKit/mobile, concurrency, failure-injection, coverage, and provider reconciliation tests.

## Ordered implementation programme

### Phase 0 — containment and evidence preservation

- [x] Require authenticated production sessions; disable OTP debug in every version-controlled production profile.
- [x] Add production configuration validation that fails closed for insecure flags or missing critical secrets.
- [x] Disable or authenticate simulators and bridge-control endpoints outside explicit development mode.
- [ ] Rotate runtime secrets and revoke existing sessions/tokens after deployment (operator action).
- [ ] Export and retain recent auth, refund, portal, payment, and subscription audit data (operator action).

**Code gate (validated locally):** anonymous merchant bootstrap, OTP disclosure,
public refunds, cross-tenant/over-limit refunds, and public privileged simulators
fail in production-configured tests. Typecheck, 452 unit tests across 69 files,
lint (zero errors; 48 pre-existing warnings), and the production build pass.
This does **not** close the two operator actions or prove that the current live
Worker has been redeployed with the hardened profile.

### Phase 1 — central authorization and privacy boundary

- [x] Introduce central route/action policy helpers with default-deny role and API-token scope checks.
- [x] Apply manager/owner restrictions to staff, rewards, campaigns, recurring billing, inventory costs, shifts, accounting, invoice status, and other sensitive mutations.
- [x] Authenticate enquiry reads, AI memory, campaign/sequence history, push subscriptions, and notification retrieval.
- [x] Add public-route and role/tenant authorization matrix tests.
- [x] Add missing public endpoint rate limits and fail-closed protection for money/identity endpoints when the limiter is unavailable.

**Code gate (validated locally):** every supported method/path is declared in a
central inventory; unknown API routes return JSON 404, wrong methods return 405
with `Allow`, and preflight is generated only for declared routes. Venue,
organization, and platform roles are disjoint. PATs use exact scopes (including
entry-only `agent:invoke`), cannot call human session/account routes, require a
venue and a current creator membership, and are migrated by `db/57`. Anonymous
enquiry/memory/history access, invoice-activity IDOR, organization role confusion,
payment-method tenant leakage, and public push payload access are closed. Public
identity/money/compute mutations are rate-inventoried and fail closed when the
limiter is unavailable. Validation: typecheck, 474/474 unit tests across 71
files, lint with zero errors (48 pre-existing warnings), production client/SSR
build, bridge syntax check, and `git diff --check` pass.

**Exit-gate status:** the local code gate is complete. Deployment of migration
57 and live negative probes remain operator work under Phase 8; Phase 2 remains
required for strong customer-token and staff-credential identity boundaries.

### Phase 2 — identity hardening

- [x] Migrate staff PINs to salted memory-hard hashes; scope login by venue/account; add lockout and rotation.
- [x] Add OTP-verified portal token issuance with hash-at-rest, expiry, revocation, rotation, and rate limits.
- [x] Minimize public loyalty responses and protect customer payment-method lookup.
- [x] Bind push subscriptions to an authenticated principal and use authenticated device-token notification fetches.

**Code gate (validated locally):** migration 58 invalidates plaintext/global staff
PINs, purges browser-mirrored PIN fields, and adds venue/account-scoped salted
scrypt credentials, database lockout, rotation/versioning, and immediate staff
session revocation. Migration 59 revokes/scrubs legacy portal links; portal access
now requires an isolated OTP challenge and stores only an expiring SHA-256 token
hash with rotation/revocation. Public loyalty lookup returns no identity data and
phone-only saved-method discovery is disabled. Migration 60 invalidates old push
subscriptions and binds each new subscription to an authenticated principal plus
a hash-only device token used by the service worker. Validation: typecheck,
482/482 unit tests across 73 files, lint with zero errors (48 pre-existing
warnings), production client/SSR build, service-worker/bridge syntax, and diff
integrity pass.

**Exit-gate status:** local code gate complete. Migrations 58–60, staff credential
re-provisioning, live OTP delivery, and live negative probes remain operator work.

### Phase 3 — server-authoritative commerce

- [x] Change QR order requests to stable menu item IDs and quantities; resolve names/prices/availability on the server.
- [x] Create server-side payment intents that bind tenant, amount, currency, source object, allowed method, tip limits, expiry, and nonce.
- [x] Make payment creation consume the server intent, not caller-selected financial metadata.
- [x] Validate subscription plans and exact prices against the billing catalogue.
- [x] Restrict agent checkout/booking to trusted scoped agents and use catalogue IDs.
- [x] Stop exposing the full active staff roster from public pay resolution; use explicitly attributed tippable profiles.

**Code gate (validated locally):** QR order submissions now carry only stable menu
IDs/quantities and persist server-resolved item/price snapshots. Migration 61 adds
single-use, hash-only payment intents binding venue, amount, currency, source,
method, tip ceiling, metadata, and expiry. Invoice/order/pay-link/billing resolvers
mint those intents; payment creation derives all financial/tenant/source fields
from the locked intent, recovers consumed-intent retries, and binds staff/tips to
the source. Migration 62 plus `split-lock.ts` serializes simultaneous split-share
grants. Subscription intents use the billing catalogue. Agent checkout/booking/
intent routes require venue-bound PATs with `agent:invoke` plus domain scopes;
catalogue checkout uses real menu UUIDs/prices and standalone signed intents must
reference a same-tenant order or invoice. Public pay resolution exposes at most
the source-attributed staff profile. Validation: typecheck and 491/491 unit tests
across 75 files pass.

**Exit-gate status:** local code gate complete for implemented server payment
surfaces. Migration 61–62 deployment and live provider/parallel split probes remain
operator work. Legacy local-only demo table/service payment surfaces now fail
closed unless they first obtain an authenticated intent; their full normalization
belongs to Phase 7.

### Phase 4 — atomic financial event processing

- [x] Add durable financial events/outbox records and atomic first-success transitions.
- [x] Process accounting, invoice settlement, COGS, commissions, subscriptions, loyalty, orders, and pay links as idempotent consumers with retries.
- [x] Fix the direct refund environment bug and enforce database-backed cumulative refund limits.
- [x] Implement proportional, idempotent reversal of revenue/A/R, tax, tips, commission, loyalty, order, and settlement state.
- [x] Add failed-event visibility, retry controls, and automated reconciliation.

**Code gate (validated locally):** migration 63 adds immutable payment snapshots,
financial events, per-consumer outbox/effect records, fenced leases, refund command
reservations, exact cumulative refund facts, append-only component/commission/
loyalty/settlement adjustments, retry audit, saved-method tenant keys, and database
immutability guards. Payment ingestion is advisory-locked and monotonic; a
canonical success event self-heals missing events without allowing stale failure
or conflicting tenant/currency/amount metadata to rewrite settlement. Consumers
claim in aggregate sequence, commit their effect marker plus domain mutation in
one transaction, reclaim stale leases, and retry every two minutes. Refunds require
stable request fingerprints, reserve capacity before provider access, retain
ambiguous outcomes, paginate the provider's documented offset/total-count list,
and atomically validate positive amount/currency/cumulative limits before booking.
Direct-sale and invoice-collection journals, tax, tips, immutable COGS value,
commission, loyalty, invoice/order/pay-link state, and settlement adjustments use
deterministic cumulative allocation. Original settlement membership is never
erased and internal batches are labelled estimates. Managers can view/retry failed
effects with an audit record. Validation: typecheck; 501/501 unit tests across 76
files; lint with zero errors (48 pre-existing warnings); production client/SSR
build; service-worker, bridge, migration-runner syntax; and diff integrity pass.

**Exit-gate status:** local code gate complete. Migration 63 has not been applied
to any database, the scheduled trigger has not been deployed, and no real
PostgreSQL multi-connection concurrency/failure-injection run or live PesaSwap
payment/refund/payout cycle has occurred. Those operational proofs remain open
under Phase 8, so production remains **NO-GO**.

**Exit gate:** duplicate, reordered, concurrent, and partially failing provider events converge to one explainable payment and GL result.

### Phase 5 — invoices, accounting, tips, and reconciliation

- [x] Validate finite positive invoice lines, quantities, tax, totals, currency, and due dates.
- [x] Persist before delivery and use an outbox for customer communications.
- [x] Prevent invoice overpayment and implement append-only void/reversal entries.
- [x] Move period-lock validation into the journal transaction.
- [x] Enforce single-currency reports until an explicit FX conversion ledger exists.
- [x] Implement equal, by-hours, fixed, and direct tip rules with unique allocation periods.
- [x] Treat payout as pending until external transfer evidence exists.
- [x] Import provider settlement/fee/payout data and match it to ledger rows; label estimates honestly.
- [x] Persist audit-chain checkpoints; external signing/anchoring remains an operator action.

**Code gate (validated locally):** migration 64 adds fail-fast invoice legacy
preflight, global opaque invoice numbers, KES/amount/status constraints, invoice
balance holds, immutable void facts, recurring occurrences, leased communication
outbox, non-overlapping tip ranges/sources/allocations, per-staff payout commands
and evidence, provider payout evidence/lines/matches, append-once estimate
membership, period events, and audit checkpoints. Invoice creation validates
safe two-decimal KES economics and persists the invoice, issue journal, audit event,
and delivery work before adapters run. Public customer chat creates pay requests,
not A/R. Manual invoice settlement fails closed; unpaid voids reverse A/R/revenue/
tax; provider overpayment is split between A/R and Customer Credits. Reports and
manual journals are KES-only. Tip rules use deterministic direct/equal/by-hours/
fixed allocation with venue checks, breaks, non-overlap, late-refund corrections,
and per-staff PesaSwap payout create/force-sync; only verified success posts the
tip-payout journal. Internal settlement estimates post no bank entry. Provider
statement staging validates payout equations/header lines and exact one-to-one
matches before an evidenced payout journal can post. Audit checkpoint creation is
append-only and tied to period close. Validation: typecheck; 516/516 unit tests
across 77 files; lint with zero errors (48 pre-existing warnings); production
client/SSR build; syntax and diff integrity pass.

**Exit-gate status:** local code gate complete. Migration 64 has not executed on
PostgreSQL because no throwaway server/Docker daemon was available. Provider
statement upload remains staging until authenticated provider pull/signature plus
bank evidence is independently verified. No external checkpoint signature/anchor,
real multi-connection invoice/tip concurrency run, or live payout/fee cycle has
occurred. Those Phase 8/operator proofs remain open, so production stays **NO-GO**.

**Exit gate:** finance can reproduce provider gross, refunds, fees, net payout, receivables, liabilities, and GL balances for a closed period with zero unexplained difference.

### Phase 6 — channel security, compliance, and reliability

- [x] Fail closed for provider webhook/service secrets in production.
- [x] Resolve every inbound receiving account to a venue; reject unknown accounts instead of falling back to `main` in production.
- [x] Check HTTP/provider response bodies and distinguish acceptance from delivery.
- [x] Model affirmative consent separately from suppression.
- [x] Enforce WhatsApp/Instagram windows and approved templates plus SMS/email marketing rules.
- [x] Claim sequence/broadcast jobs atomically and move fan-out to a durable queue.
- [x] Keep webhook acknowledgement fast by persisting ingress before asynchronous processing.

**Code gate (validated locally):** migration 65 marks legacy channel accounts
inactive until provider re-verification, scopes conversations by venue + channel
+ handle, and adds persist-first ingress, append-only affirmative consent,
account-bound approved templates, deterministic campaign/delivery rows, leased
claims, append-only attempts, staged receipts, and sequence leases. Webhooks now
verify before resolving the receiving account, reject unknown accounts, persist
normalized work, and return 202 before agent/provider execution. Ingress retries
use a stable ingress operation key; booking, enquiry, pay-link, invoice, message,
and delivery effects are idempotent. Every application outbound path queues
through one policy/worker boundary. Policy fails closed on compliance storage,
suppression and missing verified sender accounts; enforces affirmative marketing
consent, SMS quiet hours/STOP/HELP, Telegram initiation, Instagram windows, and
WhatsApp windows/account-bound templates. Adapters report `accepted`, `failed`,
`unknown`, `pull`, or explicit development simulation, preserve provider IDs and
codes, and never equate acceptance with delivery. Unknown submitted outcomes are
not blindly resent; authenticated receipts advance monotonically. Broadcast,
sequence, invoice, staff-reply, share, agent, order, and OTP work use durable
idempotency keys. Worker and protected local bridge sweeps process ingress and
outbound queues.

**Exit-gate status:** local source controls are implemented. Migration 65 has not
executed on PostgreSQL, legacy accounts/templates/consents have not been
re-verified/backfilled, and no real provider ingress, template, receipt,
concurrent-worker, crash-injection, or deliverability cycle has run. Email/SMS/
Instagram account provisioning still requires operator/provider configuration;
unsupported accounts fail closed. These are Phase 8/operator proofs, so
production remains **NO-GO**.

**Exit gate:** forged ingress is rejected, prohibited outreach cannot be sent, retries do not duplicate delivery, and analytics distinguish accepted, delivered, failed, and simulated states.

### Phase 7 — state, offline, architecture, and UX

- [x] Add revision/ETag optimistic concurrency to remaining shared state immediately.
- [x] Normalize menu/table operational edits into per-row server records and retire their client fallback authority.
- [x] Limit offline mode to read-only cached data; keep payment online-only with review-only drafts.
- [x] Extract payment and dashboard bounded-context seams (status, idempotency, tenant, shared-state storage) from the monoliths.
- [x] Add Content Security Policy and central default-deny CORS behavior.
- [x] Correct venue timezone scheduling, mobile keyboard/bottom-sheet behavior, and initial bundle hot spots.

**Code gate (validated locally):** migration 66 adds compare-and-set revisions to
the shared state store, menu items, and dining tables plus a validated venue IANA
timezone. Stale writes now return 409 instead of overwriting another device.
Real-tenant opaque state writes fail while offline and surface conflict/failure
events; menu/table API editors keep server authority and no longer claim a failed
write was saved locally. Payment outbox entries are explicitly review-only drafts:
reconnection cannot auto-charge. Service worker v4 caches only safe public shells,
never token-bearing pay/portal/authenticated navigations, and consistently falls
back to `/offline`. JWT persistence moved from localStorage to sessionStorage.
Central response hardening now includes CSP, HTTPS upgrade fallback, sensitive-
route no-referrer/no-store, COOP/CORP, and allowlisted opt-in CORS. QR preorder
wall times are converted with the venue timezone; forecast/pricing use that same
zone. Guest routes are standalone, install UI is suppressed during active guest
journeys, shared dialogs/sheets and QR checkout use dynamic viewport/safe-area
limits, zoom is restored, reduced motion is respected, and WebKit/iPhone projects
are declared. Root auxiliary UI and chart/radix/icon vendors are split into lazy/
stable chunks; eager HyperLoader and remote fonts were removed.
Bounded-context seams are extracted without changing public route behavior:
`tenant-store.ts` owns venue/session selection, `browser-storage.ts` owns local
persistence plus shared-state compare-and-set, `payment-status.ts` owns provider
status/phone/settlement mapping, and `payment-idempotency.ts` owns durable
cross-isolate payment replay protection. Universal auth and tenant-only routes no
longer import the large demo dashboard module, and the payment route no longer
owns module-level idempotency state or timers.

**Exit-gate status:** source controls for conflict safety, online-only mutation,
safe offline caching, baseline platform headers, timezone scheduling, mobile
layout, and the first bounded-context extractions are implemented. Legacy demo,
services, and retail snapshot blobs remain client-owned and are still not
normalized into per-row server records. Migration 66 has not run on PostgreSQL. Cold-offline, CSP violation, axe, Chromium/WebKit/iPhone keyboard,
multi-device concurrency, Lighthouse, and live deployment parity proofs remain
Phase 8 work. Production remains **NO-GO**.

**Exit gate:** two devices cannot silently overwrite each other, offline limitations are explicit, and core mobile flows pass accessibility and WebKit validation.

### Phase 8 — independent validation and staged release

- [ ] Run typecheck, lint, unit, integration, browser E2E, coverage, accessibility, load, concurrency, and failure-injection suites.
- [ ] Run sandbox payment/refund/dispute/settlement cycles and reconcile every record.
- [ ] Complete external penetration testing and PCI-DSS SAQ-A evidence.
- [ ] Deploy to an isolated pilot tenant with transaction/volume caps, alerts, backups, incident runbooks, and a rollback plan.
- [ ] Observe at least one complete provider settlement cycle before expanding access.

## Production approval criteria

Production approval requires all of the following:

1. Every P0 finding is closed and independently retested.
2. No anonymous route can read PII or mutate merchant/financial state.
3. No client-provided value determines an authoritative amount, tenant, or entitlement.
4. Authorization tests cover every endpoint, role, tenant, token scope, and object boundary.
5. Provider replay and concurrent delivery produce exactly one financial outcome.
6. Provider totals reconcile automatically to payment, refund, fee, settlement, and GL records.
7. Portal credentials are verified, hashed, expiring, revocable, and audited.
8. Webhook and service authentication fails closed in production.
9. External testing reports no unresolved critical or high-severity findings.
10. A capped pilot completes a full settlement period with zero unexplained ledger difference.

## Baseline validation evidence

At the review point:

- Typecheck passed.
- Unit tests passed: 439 tests across 66 files.
- Production build passed; the largest client chunk was approximately 513 kB minified.
- Lint failed with one error and 48 warnings.
- Browser smoke testing confirmed anonymous merchant mode and debug OTP exposure in production.
- Browser/HTTP E2E, coverage, accessibility, concurrency, and provider-settlement tests were not completed.

## Remediation validation log

### Phase 0 code gate

- Production profiles set `APP_ENV=production`, `AUTH_REQUIRE_LOGIN=1`,
	`AUTH_OTP_DEBUG=0`, `ALLOW_SIMULATORS=0`, and `PAYMENTS_TEST_MODE=0`.
- Startup validation returns 503 before dispatch when production auth, payment,
	webhook, CORS, bridge, or signing configuration is unsafe.
- Refunds require manager+ authentication and `payments:write` for API tokens;
	tenant ownership and cumulative settled amounts come from PostgreSQL.
- Pending provider refunds are not booked or shown as completed, and failed
	refunds never mutate the dashboard's local state.
- WhatsApp bridge controls/config and simulators are protected; ingress secrets
	are propagated by the local bridge and required outside explicit simulation.
- Validation: typecheck passed; 452/452 unit tests passed; lint passed with 48
	warnings and no errors; production client/SSR build passed.

### Phase 1 code gate

- Canonical role domains prevent `reseller_admin` and `admin` from inheriting
	venue-owner authority; reseller/platform checks are exact.
- Typed human/PAT principal helpers and strict `principalVenue` derivation fail
	closed when an authenticated venue principal lacks a venue claim.
- PATs require exact domain scopes, `agent:invoke` is not a wildcard, human-only
	routes reject PATs, and token authority is capped by the creator's current
	venue membership. Migration 57 converts legacy agent scopes and revokes orphaned
	tokens.
- The central route inventory now controls API 404/405/`OPTIONS`, carries access,
	tenant, sensitivity, role, and PAT-scope metadata, and feeds normalized dynamic
	route IDs into rate limiting.
- Protected dashboard callers now send JWTs for enquiries, inbox messages,
	analytics, Telegram controls, invoice sweeps, and push registration.
- Validation: typecheck passed; 474/474 unit tests passed; lint passed with 48
	pre-existing warnings and no errors; production client/SSR build passed; bridge
	JavaScript syntax and diff whitespace checks passed.

### Phase 2 code gate

- Staff login requires exact venue + normalized account + 6–8 digit PIN. PINs
	use salted scrypt, five failed attempts trigger a 15-minute row lock, and JWTs
	are checked against active staff/venue/credential version on every request.
- Browser/localStorage staff models no longer contain PINs; shared-state writes
	containing a nested `pin` field are rejected.
- Portal OTP purposes are cryptographically bound to venue + phone and cannot be
	consumed by merchant login. Verification, attempt accounting, one-time consume,
	old-link revocation, and new hash-only credential issuance are transactional.
- Portal responses omit pay links, provider references, and payment metadata;
	public loyalty and saved-method identity lookups disclose nothing.
- Push registration requires a human venue principal; latest payload retrieval
	requires the subscription's opaque hash-only device token.
- Validation: typecheck passed; 482/482 unit tests passed; lint passed with 48
	pre-existing warnings and no errors; production client/SSR build passed;
	service-worker/bridge syntax and diff checks passed.

### Phase 3 code gate

- Server-issued, hash-only, expiring, single-use payment intents bind venue,
	amount, currency, source, method, tip ceiling, and source metadata.
- QR and agent catalogue checkout resolve stable menu IDs, price, availability,
	and currency on the server; split-share grants serialize under an order lock.
- Payment creation requires and consumes the intent; subscription and agent
	commerce use server catalogue values and exact scopes.
- Validation: typecheck passed; 491/491 unit tests across 75 files passed.

### Phase 4 code gate

- Payment first-success transition, immutable allocation snapshot, financial
	event, and consumer outbox rows commit atomically under a payment advisory lock.
- Consumer effect marker and domain mutation share one transaction; claim tokens
	and leases fence stale workers, sequence aggregate events, and recover crashes.
- Refund commands use durable request fingerprints, namespaced provider
	idempotency, cumulative reservations, ambiguous states, paginated pull recovery,
	and an atomic terminal booking transaction.
- Refunds generate deterministic cumulative direct-sale or invoice-collection
	journal entries plus append-only tax, tip, commission, loyalty, COGS, order,
	pay-link, invoice, and settlement adjustments. Original facts and settlement
	membership are immutable.
- Scheduled recovery, manager failure visibility, manual retry, and retry audit
	are implemented. Settlement batches and UI now say `internal estimate` rather
	than claiming provider/bank reconciliation.
- Validation: typecheck passed; 501/501 unit tests across 76 files passed; lint
	passed with 48 pre-existing warnings and no errors; production client/SSR build,
	service-worker/bridge/migration-runner syntax, and diff checks passed.
- Migration 63, scheduled deployment, real PostgreSQL concurrency injection, and
	live provider settlement evidence remain operator/Phase 8 work.

### Phase 5 code gate

- Strict KES invoice validation rejects non-finite/sub-minor/mixed-sign economics,
	invalid totals/tax/due dates, and ambiguous public numbers. Remaining balances
	are held under invoice locks; terminal invoices cannot mint payment intents.
- Issuance, A/R/revenue/tax journal, audit event, and communication enqueue commit
	before delivery. Communications and reminders use fenced retries. Recurring
	occurrences are idempotent/recoverable and schedules soft-delete.
- Manual paid/pay state is disabled; unpaid voids are immutable balanced reversals.
	Excess provider collections post as Customer Credits rather than negative A/R.
- KES-only accounting, sales, fees, shifts, settlement estimates, and multistore
	reports prevent silent currency aggregation. Internal estimate batches do not
	post fictional bank/fee entries.
- Direct/equal/by-hours/fixed tip pools use immutable non-overlapping periods,
	venue staff checks, deterministic rounding, break-adjusted hours, late-refund
	corrections, and per-staff pending payout commands. PesaSwap payout success is
	pulled/verified before evidence and GL posting.
- Provider statement staging is immutable and requires balanced header/line totals,
	exact terminal local matches, one-to-one constraints, and zero difference before
	a provider payout journal posts. Estimate and actual fee concepts remain separate.
- Period close persists immutable KES audit checkpoints; export discloses
	truncation and hashes material entry/line identity fields.
- Validation: typecheck passed; 516/516 unit tests across 77 files passed; lint
	passed with 48 pre-existing warnings and no errors; production client/SSR build,
	JavaScript syntax, and diff integrity checks passed.
- Migration 64 execution, authenticated provider/bank evidence, external checkpoint
	signing/anchoring, and real PostgreSQL/live payout concurrency remain operator work.

### Phase 6 code gate

- Receiving-account routing and sender-account selection are verified, active,
	venue-bound, and fail closed; no unknown account falls back to `main`.
- Provider webhooks persist deterministic ingress rows before 202 ACK. Leased
	workers retry processing with stable operation keys and original receive times.
- Suppression and immutable affirmative consent are separate. STOP halts active
	sequences; HELP and opt-out confirmations have narrow compliant handling.
- WhatsApp/Instagram windows, WhatsApp account-bound approved templates,
	Telegram initiation, SMS quiet hours/footer, and email unsubscribe text are
	centralized before provider access.
- Durable outbound delivery rows, submitted/terminal attempts, unknown-outcome
	fencing, staged receipts, provider IDs/codes, and monotonic delivered/read state
	replace the old request-bound `sent` contract.
- Broadcasts resume missing deterministic recipients; sequence/invoice state
	advances only after delivery state permits it; DLQ retry only requeues known
	failures and preserves evidence.
- Validation: typecheck passed; focused Phase 6 and route-policy tests passed;
	lint passed with 47 pre-existing warnings and no errors; bridge JavaScript
	syntax, production client/SSR build, and diff integrity passed during the phase.
- Migration 65 execution, account/template/consent provisioning, real PostgreSQL
	concurrency/crash injection, and provider-authenticated delivery proof remain
	operator/Phase 8 work.

### Phase 7 code gate

- Shared JSON state uses explicit revisions; creation requires revision zero and
	stale compare-and-set writes return the current server revision with HTTP 409.
- Menu items and dining tables carry per-row revisions/updated timestamps;
	PATCH/DELETE require the observed revision. Production replace-all menu sync is
	disabled so it cannot bypass row controls.
- Real-tenant offline opaque-state writes are blocked before local mutation.
	Payment entries are 24-hour, device-scoped review drafts and never auto-submit.
- Service worker v4 has a stable `/offline` fallback, versioned cache eviction,
	awaited cache writes, and denies caching pay/portal/authenticated/query-token
	navigations, private/no-store responses, and API calls.
- CSP, HTTPS redirect fallback, no-store/no-referrer token documents, COOP/CORP,
	strict handler CORS stripping, and opt-in central preflight are implemented.
- Venue IANA timezones drive QR scheduled-order conversion and demand/pricing
	buckets. Offsetless Nairobi wall-time parsing is unit tested.
- Guest route layout, zoom, safe-area/dynamic viewport behavior, reduced motion,
	lazy root auxiliaries, vendor chunk boundaries, and WebKit/iPhone test projects
	are in source.
- Bounded-context extraction: `tenant-store.ts` (venue/session), `browser-storage.ts`
	(local persistence + shared-state CAS), `payment-status.ts` (provider status,
	phone, settled amount), and `payment-idempotency.ts` (durable cross-isolate
	replay protection). Public route behavior and exports are unchanged.
- Validation: typecheck and 528/528 unit tests across 80 files passed; lint passed
	with zero errors; production client/SSR build, service-worker and bridge syntax,
	and diff integrity passed.
- Remaining open: legacy demo/services/retail blob normalization, migration 66
	execution, browser/accessibility/WebKit/load/concurrency proof, and deployed
	CSP/static-header verification.

## Change-control policy

- Security configuration and migrations are version controlled.
- Every remediation includes a regression test before its checkbox is closed.
- Production defaults fail closed; explicit development flags may enable simulators or debug behavior only without production bindings.
- Financial corrections are append-only reversals, never destructive edits.
- External/operator tasks remain visibly open and cannot be marked complete by a code change alone.
