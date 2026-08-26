---
name: auth-tenancy
description: >-
  Authentication, multi-tenant isolation, RBAC, rate limiting, plan limits and the
  per-request database client. Use when a task touches login/signup, JWTs, tenant
  isolation, the venue claim, roles/permissions, rate limiting, plans/quotas, or
  Postgres access on Workers.
---

# Auth, tenancy & security

The security spine. Read `SECURITY.md` for the full posture.

## Key files

- `src/api/auth.ts` — `/api/auth/{login,signup,session,me,password,google,
google/config,switch-venue}`, plus `requireAuth`, `requireRole`, `resolveVenue`.
- `src/api/venues.ts` — `GET /api/venues` (member stores) + `POST /api/venues` (add a store).
- `src/api/multistore.ts` — `GET/POST/DELETE /api/venues/members` (per-store team +
  roles) + `GET /api/venues/rollup` (cross-store revenue rollup).
- `src/lib/tenancy.ts` — pure helpers `venueFromPayload`, `planOf`, `planLimit`, `PLAN_LIMITS`.
- `src/lib/route-policy.ts` — canonical method/path inventory and access/tenant/
  sensitivity/role/PAT-scope metadata; owns API 404/405/`OPTIONS` behavior.
- `src/lib/route-authorization.ts`, `src/lib/principals.ts` — pre-dispatch
  human/PAT authorization and typed principal/context helpers.
- `db/57-api-token-principals.sql` — immutable PAT creator binding, legacy
  `agent` scope conversion, and orphan-token revocation.
- `db/42-user-venues.sql` — `user_venues` membership (multi-store).
- `src/lib/jwt.ts` — HS256 sign/verify + PBKDF2 hashing.
- `src/lib/rate-limit.ts` — `enforceRateLimit` (central gate) + `RULES`.
- `src/lib/db.ts` — `withRequestSql` (per-request Postgres client) + `getSql`.
- `src/lib/auth.ts` — client: `jwtLogin`, `signup`, `googleLogin`, `authFetch`,
  `ensureSessionToken`; **pins the browser's active tenant** (`applyTenant` →
  `setCurrentVenueId` + venues list) to the JWT `venue` on real login/signup.
- `src/lib/merchant-dashboard.ts` — client tenant store: `isDemoVenue`,
  `createMerchantStarterData`, `getMerchantIdentity`, venue-aware seeding.
- `src/lib/use-merchant-identity.ts` — hook feeding POS/KE-QR the per-venue name+till.
- `db/10-users.sql`, `db/11-ratelimit.sql`, `db/12-plan.sql`.

## Rules (do not regress)

- **Tenant isolation:** authenticated venue actions use the route policy's
  `principalVenue` boundary and fail closed when the principal lacks a venue
  claim. `resolveVenue`/`venueFromPayload` remain for explicitly public selector
  routes; never use their `main` fallback as an authenticated tenant boundary.
- **Route inventory:** every API method/path must exist in `ROUTE_POLICIES`, have
  a registered handler, and pass ambiguity/completeness tests. Unknown APIs never
  reach SSR; wrong methods return 405; preflight is declared-route-only.
- **Role domains:** only `staff → supervisor → manager → merchant` is an
  inheritance ladder. `reseller_admin` and `admin` are exact organization and
  platform roles and never inherit venue authority.
- **PATs:** `agent:invoke` is entry-only, never a wildcard. A PAT needs exact
  domain scopes, a bound venue, current creator membership, and cannot call
  human-only account/credential/membership/billing/org/staff/token routes.
- **`app_settings` is GLOBAL** (PK on `key` only, no `venue_id`). For per-venue
  config, **namespace the key** as `<key>:<venue>` (e.g. `whatsapp_cloud:<venue>`,
  `telegram:<venue>`, `push_latest:<venue>`) and read the venue key first with a
  fallback to the global key + env. Platform-level keys (`auth`, `vapid`, `ke_qr`,
  `public_base_url`) stay global. Inbound channel→venue routing is a separate
  `channel_accounts(channel, account_id)->venue_id` table (`db/44`).
- **Client tenancy:** a real merchant's localStorage is namespaced by their venue
  (login pins `currentVenue` to the JWT claim). Demo venues (`main`/`cbd`/`kisumu`)
  seed the rich showcase; a real venue (`v_*`) gets an EMPTY starter with its own
  business name (never the shared "Sade's Atelier" demo). Surface the tenant's
  identity via `getMerchantIdentity()` / `useMerchantIdentity()`, not the
  `MERCHANT_NAME` / `TILL_NUMBER` constants.
- **Multi-store:** one login can own several stores via `user_venues` (many-to-many;
  `app_users.venue_id` stays the primary). `GET /api/venues` lists a merchant's member
  stores; `POST /api/venues` adds one (plan-capped, `planLimit(plan,"stores")`);
  `POST /api/auth/switch-venue` **re-mints the JWT** for a store the user is a member
  of (membership verified server-side — a token can never be pointed at a store the
  user doesn't own). Each store is fully isolated (all entities are `venue_id`-scoped).
- **Store roles (per-store RBAC):** `user_venues.role` is the **authoritative
  per-store** role (not the token's current-venue claim). `GET/POST/DELETE
/api/venues/members` (`src/api/multistore.ts`) let a **manager+ at that store**
  invite/re-role/remove members. Guards are pure + unit-tested in `tenancy.ts`:
  `canGrantRole` (target role ≤ caller rank, known team role only — never `admin`/
  `customer`) and `canRemoveMember` (never remove someone who outranks you); the API
  also plan-caps team size and refuses to remove a store's **last owner**. Inviting
  an unknown email find-or-creates an `app_users` row with an **unusable password**
  (they gain access via Google or a reset — no shared secret is issued).
- **Chain rollup:** `GET /api/venues/rollup` aggregates net/gross/tips/refunds/txns
  across every store the login is **manager+** of (revenue never leaks to a
  staff-level membership). UI: `/dashboard/chain`; team UI: `/dashboard/team`.
- **Enforcement:** staff mutations use role/action policy. Customer routes use
  their explicit public/opaque-token boundary. Service routes never use human JWT
  auth but must validate their provider signature/shared secret; they are not
  anonymous privileged routes.
- **RBAC:** `requireRole(request, env, ["admin"])` for platform-admin actions
  (e.g. changing the admin password).
- **Rate limiting:** add new public endpoints to `RULES` in `rate-limit.ts` so the
  central gate in `server.ts` protects them (429 + Retry-After).
- **Plan limits:** `planOf(payload)` + `planLimit(plan, entity)` / `planLimitMessage`;
  tokens without a plan claim are treated as `pro` (uncapped) so demo/admin flows
  aren't capped. Free-tier caps are **enforced on create** (count vs cap → 402) for
  `recurring`, `staff`, `tables`, `menu_items`, `contacts`. Existing data is never
  touched — a merchant at/over a cap simply cannot add more.
- **DB on Workers:** every request runs inside `withRequestSql`; `getSql` returns
  the request-scoped client. Never reintroduce a long-lived module-level client
  for the Workers path (cross-request I/O is forbidden).

## Toggles (env)

- `AUTH_REQUIRE_LOGIN=1` — disable anonymous session bootstrap (force real login).
- `APP_ENV=production`, `AUTH_OTP_DEBUG=0`, `ALLOW_SIMULATORS=0`, and
  `PAYMENTS_TEST_MODE=0` are mandatory in production; runtime validation fails
  closed before dispatch.
- `AUTH_DISABLE_SIGNUP=1` — close self-serve signup.
- `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_ALLOWED_EMAILS`.

## Common tasks

- **New endpoint:** add one policy row, its registered handler key, role/scopes,
  tenant source, sensitivity, tests, and a fail-closed rate rule when public and
  identity/money/PII/compute-sensitive.
- **New venue action:** prefer `principalVenue` and include the tenant in the same
  SQL object predicate. Use exact organization/platform checks across domains.

## Guidelines

- Rotate the default admin password (`pesaswap-admin`) and `JWT_SECRET` before
  production.
- Keep pure logic in `src/lib/tenancy.ts` (unit-tested); import into `api/auth.ts`.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: auth-tenancy -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Revocable organisation and venue membership, least-privilege RBAC and scopes, membership-version session invalidation, secure recovery, rate limits, device/session controls, and immutable identity events.
- Default-deny tenant isolation in every query, mutation, queue, webhook, export, support action, personal token, service principal, and agent tool path.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
