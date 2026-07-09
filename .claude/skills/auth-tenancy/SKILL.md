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
- **Tenant isolation:** venue-scoped handlers derive the venue via
  `resolveVenue(request, env, url)` — the JWT `venue` claim wins over `?venue=` /
  `body.venue`. Never trust `body.venue` for a tenant write.
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
- **Enforcement:** staff mutations are gated with `requireAuth`; **public**
  (pay/chat/enquiries/webhooks) and **service** (bridge sweeps `invoicing/run`,
  `sequences/run`, `bridge/inbound`) routes stay open.
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
- `AUTH_DISABLE_SIGNUP=1` — close self-serve signup.
- `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_ALLOWED_EMAILS`.

## Common tasks
- **New tenant endpoint:** gate mutations with `requireAuth`, resolve venue with
  `resolveVenue`, and (if public) add it to the rate-limit `RULES`.
- **New role-gated action:** use `requireRole`.

## Guidelines
- Rotate the default admin password (`pesaswap-admin`) and `JWT_SECRET` before
  production.
- Keep pure logic in `src/lib/tenancy.ts` (unit-tested); import into `api/auth.ts`.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
