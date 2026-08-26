# Production capability evidence — four runtime tiers

This procedure operationalises the
[Production Go-Live Capability Contract](../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md).
A capability is not production-ready until its applicable checks have retained
evidence across all four runtime tiers. Source-complete work or success in one
tier must be reported at that narrower evidence state.

## The four tiers

| Tier           | Where                                                | Runtime                                 | Database                                        |
| -------------- | ---------------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| **Dev**        | `localhost:8080` (`docker-compose.yml`)              | Vite dev (HMR)                          | local Postgres `pesaswap-postgres`              |
| **Prod-local** | `localhost:8787` (`docker-compose.prod.yml`)         | workerd / wrangler (mirrors Cloudflare) | local Postgres `pesaswap-postgres-prod`         |
| **Sandbox**    | `pesaswap-merchant-app-sandbox.pesaswap.workers.dev` | Cloudflare Workers, simulated payments  | isolated Neon `pesaswap_sandbox` via Hyperdrive |
| **Production** | `pesaswap-merchant-app.pesaswap.workers.dev`         | Cloudflare Workers                      | Neon (via Hyperdrive)                           |

## The checklist

1. **Validate source** with `npm run customizations:check`, `npm run typecheck`,
   `npm run lint`, and `npm test`, plus focused integration, browser, contract,
   accessibility, device, security, finance and load checks warranted by risk.
2. **Migrations** — one idempotent runner (`scripts/migrate.mjs`, tracked by a
   `schema_migrations` ledger) is the single mechanism for **every** database
   (local + managed Neon), so nothing drifts. It auto-detects TLS (Neon requires
   it; local Postgres has none). Apply a new `db/NN-*.sql` with:
   `MIGRATE_DATABASE_URL="<url>" npm run migrate` (a no-op when nothing is new).
   - CI (e2e job) runs it against its Postgres; the deploy job runs it against
     production + sandbox Neon (gated on the `NEON_DATABASE_URL` /
     `NEON_SANDBOX_DATABASE_URL` secrets).
   - dev + prod-local also mount `db/` as `docker-entrypoint-initdb.d` for a fresh
     volume, and their ledgers are back-filled so the runner stays a no-op there.
     Do **not** put semicolons inside SQL comment lines (the local splitter breaks on them).
3. **Register** any new route handler in `src/server.ts`. A build regenerates
   `src/routeTree.gen.ts` for new route files.
4. **Build once** and identify the immutable commit/artifact and migration set.
   Production and sandbox must use the same source/build inputs with only their
   environment-specific bindings and secrets.
5. **Rebuild and verify prod-local** so `:8787` reflects the new code:
   `docker compose -f docker-compose.prod.yml up -d --build merchant-app-prod`.
   The image runs `scripts/bundle-prodlocal.mjs` after the build to emit a single
   self-contained `dist/server/worker.single.js` and serves it with `wrangler dev
--no-bundle`. This is required because the route-split build re-exports shared
   constants from the worker entry (`export { INSTANT_PAYOUT_PERCENT as I, … }`),
   which newer workerd rejects as invalid named entrypoints ("Incorrect type for
   map entry 'I'"). Do **not** revert the prod CMD to a plain `wrangler dev` — it
   crash-loops. The shared `dist/` used by `wrangler deploy` is untouched.
6. **Deploy and verify sandbox first** with `wrangler deploy --env sandbox`.
   Exercise non-live-money journeys, contracts, webhooks, migrations and the
   applicable desktop, phone, tablet/handheld and SDK/peripheral matrix against
   isolated data.
7. **Deploy production only after approval** with `wrangler deploy`. Use
   controlled smoke/canary checks; never run destructive or live-money probes
   without an approved procedure. Confirm health, queues, financial integrity,
   telemetry, alerts and rollback/compensating readiness.
8. **Retain evidence** identifying scope, commit/artifact, migration set,
   configuration version, runtime, device/provider, tester, time, result,
   exceptions, operator actions and recovery outcome.

## Skill / agent expectation

Every `SKILL.md` and custom agent carries a managed production ownership block
pointing here and to the canonical contract. `npm run customizations:check`
enforces that inventory. Agents report only the evidence completed; this
checklist does not turn a source change into a deployment or certification claim.

## Sandbox environment (test payments)

Alongside production there is a **sandbox** Worker built from the SAME codebase,
so partners can try the full journey with no real money:

|                 | Production                                   | Sandbox                                              |
| --------------- | -------------------------------------------- | ---------------------------------------------------- |
| URL             | `pesaswap-merchant-app.pesaswap.workers.dev` | `pesaswap-merchant-app-sandbox.pesaswap.workers.dev` |
| Payments        | live M-Pesa (`PAYMENTS_TEST_MODE=0`)         | simulated (`PAYMENTS_TEST_MODE=1`)                   |
| Database (Neon) | `neondb` (Hyperdrive `37e129fb…`)            | `pesaswap_sandbox` (Hyperdrive `f9c735c4…`)          |
| Deploy          | `wrangler deploy`                            | `wrangler deploy --env sandbox`                      |

- Config lives in `wrangler.toml` under `[env.sandbox]`; named envs do **not**
  inherit `[vars]`/bindings, so they are redeclared there.
- The sandbox has its own **separate** Neon database so test data never mixes
  with production. New `db/NN-*.sql` files are applied automatically by the CI
  migration runner (`scripts/migrate.mjs`) to BOTH the production and sandbox
  Neon databases, gated on repo secrets:
  - `NEON_DATABASE_URL` — production Neon (database `neondb`)
  - `NEON_SANDBOX_DATABASE_URL` — sandbox Neon (database `pesaswap_sandbox`)
    Until those secrets are set the steps skip (CI stays green). Manual apply:
    `MIGRATE_DATABASE_URL="<sandbox-neon-url>" npm run migrate`.
- The sandbox has a fixed `JWT_SECRET` secret (set via `wrangler secret put
JWT_SECRET --env sandbox`) so tokens verify consistently on its fresh DB.
- One build serves both (the client uses same-origin APIs); a public
  `GET /api/payments/config` drives the on-page "Sandbox" badge.
