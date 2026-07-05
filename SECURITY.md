# Security & Production Readiness

Status of the risks/gaps hardening. ✅ = implemented in this repo, 🟡 = foundation
in place (needs external resources to complete), ⛔ = not started.

## Authentication & tenancy
- ✅ **JWT** sessions (HS256) with **PBKDF2** password hashing (`src/lib/jwt.ts`).
- ✅ **Self-serve signup** (`POST /api/auth/signup`) provisions a venue + `app_users`
  row; **login** checks the seeded admin then `app_users`.
- ✅ **Tenant isolation** — venue is derived from the JWT `venue` claim
  (`resolveVenue`/`venueFromPayload`), so a valid token **cannot be pointed at
  another tenant** via `?venue=` or `body.venue` (verified by a 2-tenant test).
- ✅ **RBAC** — `requireRole(request, env, roles)`; the platform admin-password
  change is admin-only (was a privilege-escalation hole).
- ✅ **Enforcement toggles** — `AUTH_REQUIRE_LOGIN=1` disables the anonymous demo
  session bootstrap (forces real logins; **set on the live deploy**);
  `AUTH_DISABLE_SIGNUP=1` closes signups.
- ✅ **Sensitive read isolation** — `requireAuth` now gates the high-PII reads
  (`/api/contacts`, `/api/invoices` + `/stats`, `/api/whatsapp/conversations` +
  `/messages`), and `venueFromPayload` pins non-admin tokens to their own venue
  (a missing claim no longer grants `?venue=` access unless `role==='admin'`).
- 🟡 **Remaining read gating** — a few lower-sensitivity venue GETs still lack a
  hard `requireAuth` (`/api/state`, `/api/dlq`, `/api/analytics/agent`,
  `/api/kb`, `/api/recurring`); gating these also needs the `/api/state` +
  invoice-activity client calls moved to `authFetch` (tracked in BACKLOG).
- ✅ **Admin default removed in prod** — when `ADMIN_PASSWORD` is unset on a real
  deploy (HYPERDRIVE binding present) the seed uses a random secret, never the
  `pesaswap-admin` dev default; `ADMIN_PASSWORD` / `JWT_SECRET` / `ADMIN_EMAIL`
  apply on load. The live deploy has strong `ADMIN_PASSWORD` + `JWT_SECRET` set.

## Hardening from the automated security review
- ✅ **Payments webhook fail-closed** — `POST /api/webhooks/pesaswap` reads
  `PESASWAP_WEBHOOK_SECRET` from the Worker `env` binding and **rejects** when the
  secret is unset or the HMAC signature is invalid (was fail-open → forged
  `payment.succeeded` events broadcast as real sales). Same env fix lets payment
  create/refund read `PESASWAP_API_KEY`.
- ✅ **A2A privilege** — `POST /api/a2a` only grants the staff role (invoice
  creation, contact reads) when a shared `A2A_API_KEY` / `OMNI_API_KEY` is
  presented via `x-api-key`; otherwise it runs as `customer`. Role is no longer
  taken from the request body.
- ✅ **IDOR** — `/api/whatsapp/messages` requires auth and joins on
  `conversations.venue_id`; `/api/whatsapp/reply` scopes its conversation lookup
  by venue.
- ✅ **Security headers** — every response carries `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and
  HSTS (WebSocket upgrades skipped). CORS stays `*`; tighten to the app origin
  once on a fixed domain.
- 🟡 **Provider webhook signatures** — inbound WhatsApp/Telegram/Instagram/SMS
  webhooks + `/api/invoicing/run` still need provider-signature / shared-secret
  verification (Alert 7). Tracked in BACKLOG.

## Rate limiting / abuse protection (#2)
- ✅ Postgres fixed-window limiter (`src/lib/rate-limit.ts`) applied centrally in
  `server.ts` to public endpoints: `signup` (5/min), `login` (10/min),
  `session` (30/min), `google` (10/min), `password` (5/min), `enquiries` (10/min),
  `chat` (20/min), `payments/create` (10/min), `refunds` (10/min), `a2a` (30/min).
  Over-limit returns **429** with `Retry-After`. Fails open if the DB is down.
  > Note: effective on dev (direct Postgres driver) and on real Cloudflare
  > (Hyperdrive fronts per-request pooling). On the **local workerd emulator** the
  > first per-request DB write can fail open because postgres.js reuses pooled
  > sockets across requests (a Workers-runtime limitation, not a logic bug).
- 🟡 **Next:** per-account (not just per-IP) limits, WAF/bot rules, and a CAPTCHA
  on signup for stronger anti-automation.

## Payments & PCI (#3)
- ✅ **Durable ledger** — `payments` table (`db/13-payments.sql`); create persists a
  record (replaces the ephemeral in-memory Map). Amounts in minor units.
- 🟡 **PCI posture (target SAQ-A):** card data is entered in the provider's hosted
  fields / HyperLoader — **no PAN touches our servers**. Keep it that way; never
  log or store card numbers. Server holds only tokens/`payment_id`.
- ⛔ **External to complete:** certified provider sandbox → production credentials,
  settlement/payout reconciliation, dispute/chargeback handling, webhook signature
  verification hardening, and a formal PCI-DSS SAQ-A attestation.

## Testing, CI/CD & monitoring (#4)
- ✅ **CI** (`.github/workflows/ci.yml`): typecheck + lint + test + build, plus a
  Cloudflare deploy job (needs `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` secrets).
- ✅ **Unit tests** incl. security helpers (`__tests__/unit/security.test.ts`:
  venue isolation, plan limits, client-IP parsing).
- ✅ **E2E tests** — HTTP flows (`__tests__/e2e/pwa-to-backoffice.e2e.ts`,
  `npm run test:e2e`) **and browser UI** (`e2e-browser/pwa.spec.ts`,
  `npm run test:e2e:browser`, Playwright/chromium): full PWA → back-office flows —
  signup→tenant, customer enquiry, invoice→public pay link, web chat→inbox,
  tenant isolation, plus real click-through of the onboarding wizard, enquiry
  form, install button and pay page.
- ✅ **CI E2E job** (`.github/workflows/ci.yml` → `e2e`): spins up an ephemeral
  **pgvector** service, applies `db/*.sql`, starts the app, and runs both E2E
  suites (installs the Playwright browser); uploads artifacts on failure.
- ✅ **Per-request Postgres client** (`withRequestSql` in `src/lib/db.ts`) — a
  fresh AsyncLocalStorage-scoped client per request on Workers, so sockets never
  cross requests (fixes cold-start/rate-limit flakiness; Node dev keeps a module
  cache). Rate limiting now works cold on prod.
- ✅ Central SSR error normalization + capture (`src/lib/error-capture.ts`,
  `src/server.ts`).
- 🟡 **Next:** run the E2E suite in CI against an ephemeral Postgres; wire an
  **APM/error tracker** (e.g. Sentry) and uptime/alerting; run `wrangler deploy`
  for a real edge deploy (local `:8787` is workerd emulation).

## Tenancy limits & billing (#5)
- ✅ **Per-tenant plan** — `plan` column on `app_users` (default `free`), carried in
  the JWT; `PLAN_LIMITS` enforced (free tier caps recurring schedules). Tokens
  without a plan (admin/demo) are treated as uncapped.
- ⛔ **External to complete:** a billing processor (plans, metering, invoices),
  usage dashboards, and hard quota enforcement across all entities.

## Environment variables
| Var | Purpose |
| --- | --- |
| `JWT_SECRET` | Override the auto-generated JWT signing secret |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed/override the platform admin credential |
| `AUTH_REQUIRE_LOGIN` | `1` disables anonymous session bootstrap (force real login) |
| `AUTH_DISABLE_SIGNUP` | `1` closes self-serve signup |
| `GOOGLE_CLIENT_ID` / `GOOGLE_ALLOWED_EMAILS` | Google sign-in |
| `PESASWAP_API_KEY` / `PESASWAP_WEBHOOK_SECRET` / `PESASWAP_URL` | Payment provider |
