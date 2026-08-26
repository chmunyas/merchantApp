# Security and Production Readiness

The canonical risk assessment and ordered remediation programme is
[`review.md`](review.md). The current decision is **NO-GO for unrestricted live
money movement or customer PII**. A checked code item does not imply deployment,
credential rotation, provider certification, penetration testing, or PCI evidence.

## Validated containment

- Production configuration is explicit: `APP_ENV=production`,
  `AUTH_REQUIRE_LOGIN=1`, `AUTH_OTP_DEBUG=0`, `ALLOW_SIMULATORS=0`, and
  `PAYMENTS_TEST_MODE=0`.
- `src/lib/runtime-security.ts` rejects insecure production configuration before
  normal route dispatch. Production requires a JWT secret, PesaSwap API and
  webhook secrets, and a restricted CORS origin. A configured bridge also
  requires its control/inbound secret.
- OTP codes are never returned by the production handler, even if the debug flag
  is accidentally enabled.
- Refunds require a manager-or-higher principal. Personal API tokens additionally
  require `payments:write`; JWT tenant scope, original amount, and cumulative
  settled refunds are resolved from PostgreSQL. Client-supplied refund actor data
  cannot override the server principal.
- Pending or failed provider refunds are not booked as settled and do not mutate
  the dashboard's local transaction status.
- WhatsApp bridge status/QR/logout/config are owner-gated. Channel simulators are
  manager-gated and exist only when explicitly enabled outside production.
- WhatsApp, Instagram, Telegram, SMS, email, and bridge ingress reject a missing
  or invalid configured secret outside explicit non-production simulation.
- Passwords use salted PBKDF2, JWTs are HS256-signed, personal API tokens are
  hashed and revocable, and real non-admin principals are pinned to their venue.
- Standard security headers and production CORS rewriting are applied centrally.
- Every supported API method/path is now declared in a central policy with its
  access class, tenant source, sensitivity, minimum venue role, and PAT scopes.
  Unknown API paths return JSON 404, wrong methods return 405 with `Allow`, and
  preflight exists only for declared browser routes.
- Venue, organization, and platform roles are separate domains. Human JWTs and
  PATs are distinct principals; account, credential, membership, billing-owner,
  organization, channel-secret, staff, and token-management actions are human-only.
- PATs require exact domain scopes. `agent:invoke` grants entry to the agent
  surface only, token role is capped by current creator membership, and a missing
  authenticated venue claim fails closed.
- Staff PINs use salted memory-hard scrypt hashes and venue/account-scoped lookup.
  Database lockout, credential versioning, and per-request staff-session checks
  revoke rotated/deactivated credentials immediately; plaintext PINs are purged
  from staff rows and mirrored browser state.
- Customer portal links require an isolated OTP challenge, store only a random
  bearer hash, expire after 30 days, rotate older links, and support revocation.
  Phone-only loyalty and saved-method lookups return no customer data.
- Push subscriptions require an authenticated human venue principal. The service
  worker retrieves payloads with a hash-only venue-bound device credential rather
  than a public venue selector.

Phase 0–4 regression coverage includes production startup validation, anonymous
session denial, OTP disclosure, refund role/scope/tenant/amount boundaries,
pending-refund behavior, simulator hiding, bridge protection, route inventory and
dispatch parity, 404/405/preflight behavior, disjoint role domains, PAT human-only
denials, scope negatives, staff/portal/push credentials, payment intents,
outbox fencing, refund idempotency/ambiguity, and missing-venue denial. The latest
local gate passed typecheck, 501 unit tests across 76 files, lint with zero errors
(48 existing warnings), and the production client/SSR build.

## Important trust semantics

### PesaSwap webhooks

The provider endpoint must respond quickly. A valid raw-body HMAC may be processed
inline. An unsigned or invalid event is acknowledged but causes **no financial
side effect**; authenticated pull reconciliation establishes authority. Do not
describe this as “reject every invalid webhook,” and do not infer settlement from
HTTP acknowledgement.

### Provider/channel delivery

An accepted HTTP request is not proof that a message was delivered or that a
refund/payment settled. Persist and display provider states honestly. Complete
delivery receipts, channel-window/template enforcement, affirmative consent, and
durable queueing remain open in Phase 6.

### Financial consistency

Payment first-success, immutable allocation snapshots, financial events, and
consumer outbox records now commit atomically. Consumer effects use aggregate
ordering, fenced leases, and one transaction for their marker plus domain
mutation. Refund commands reserve cumulative capacity under the payment lock,
retain ambiguous provider outcomes, paginate provider reconciliation, and book
append-only proportional corrections. Failed effects are visible and retried.
Internal settlement batches remain estimates until matched to provider and bank
statements. Migration/deployment and live failure/concurrency evidence are still
open; see Phases 4–5 and 8 in [`review.md`](review.md).

Phase 5 local controls add strict KES invoice validation, balance holds,
persist-before-send communications, append-only unpaid voids, recurrence
occurrences, non-overlapping tip periods with real allocation rules, pending
evidence-backed tip payouts, KES-only reports, provider statement staging, and
persistent period checkpoints. Manager-uploaded evidence is not itself trusted
provider/bank proof; migration 64 and live provider/postgres validation remain
open operator gates.

## Remaining release blockers

1. Apply migrations 57–63, rotate/re-provision credentials, and deploy the secure profiles.
2. Wire production portal Turnstile delivery/revocation UX and run live negative probes.
3. Correct remaining invoice-input, tip-pooling, currency, and provider payout matching rules.
4. Complete consent, delivery-state, provider-window, queue, and tenant-routing work.
5. Remove last-write-wins shared state and constrain offline mutations.
6. Complete independent security, accessibility, concurrency, failure-injection,
   provider-cycle, and staged-pilot validation.

## Production environment requirements

| Variable | Requirement |
| --- | --- |
| `APP_ENV` | Must be `production` on every production runtime |
| `AUTH_REQUIRE_LOGIN` | Must be `1` |
| `AUTH_OTP_DEBUG` | Must be `0` |
| `ALLOW_SIMULATORS` | Must be `0` |
| `PAYMENTS_TEST_MODE` | Must be `0` |
| `JWT_SECRET` | Long random Worker secret; rotate after containment deployment |
| `PESASWAP_API_KEY` | Required Worker secret for live provider calls |
| `PESASWAP_WEBHOOK_SECRET` | Required Worker secret for trusted inline events |
| `PESASWAP_URL` | `https://api.pesaswap.io` in production |
| `CORS_ALLOWED_ORIGIN` | Explicit trusted origin/allowlist; never `*` |
| `WHATSAPP_BRIDGE_URL` | Optional; if set, `WHATSAPP_BRIDGE_TOKEN` is mandatory |
| `WHATSAPP_APP_SECRET` | Required before enabling Meta WhatsApp ingress |
| `TELEGRAM_WEBHOOK_SECRET` | Required before enabling Telegram ingress/poll forwarding |
| `INSTAGRAM_APP_SECRET` | Required before enabling Instagram ingress |
| `BRIDGE_SECRET` | Required for SMS or a separately keyed bridge ingress |
| `EMAIL_WEBHOOK_SECRET` | Required before enabling email inbound parse |
| `CRON_SECRET` | Required for service-triggered invoicing/sequence sweeps |
| `TURNSTILE_SECRET` | Required for production account and portal OTP requests |
| `AT_API_KEY` / `AT_USERNAME` or WhatsApp credentials | Required for live portal OTP delivery |

Secrets belong in the platform secret store, never source control, logs, URLs, or
client bundles. Credential rotation, session/token revocation, evidence export,
provider certification, penetration testing, and PCI-DSS SAQ-A evidence are
operator/external tasks and remain open.

## Incident containment before any pilot

1. Preserve recent auth, OTP, refund, portal, payment, subscription, webhook, and
   administrative evidence.
2. Deploy only after production secret/config preflight succeeds.
3. Rotate JWT/admin/provider/channel/cron secrets and revoke old sessions/tokens.
4. Verify anonymous session, debug OTP, refund, simulator, bridge, and forged
   ingress probes against the deployed version.
5. Keep transaction/volume caps in place and retain a tested rollback path.
