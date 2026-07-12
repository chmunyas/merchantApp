# Definition of Done — full parity (all feature functions)

Every feature function in this repo must reach **full parity across all three
runtime tiers** before it is considered done. This is a **standard requirement for
all skills and agents** — a feature that works on only one tier is not done.

## The three tiers
| Tier | Where | Runtime | Database |
| --- | --- | --- | --- |
| **Dev** | `localhost:8080` (`docker-compose.yml`) | Vite dev (HMR) | local Postgres `pesaswap-postgres` |
| **Prod-local** | `localhost:8787` (`docker-compose.prod.yml`) | workerd / wrangler (mirrors Cloudflare) | local Postgres `pesaswap-postgres-prod` |
| **Production** | `pesaswap-merchant-app.pesaswap.workers.dev` | Cloudflare Workers | Neon (via Hyperdrive) |

## The checklist
1. **Validate** in the dev container:
   `docker exec -w /app pesaswap-merchant-app npm run typecheck` then `npm test`
   (142 unit tests) — plus E2E (`npm run test:e2e`) where the change warrants it.
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
4. **Build + deploy** from **inside** the container (host `node_modules` is empty):
   `docker exec -w /app -e CLOUDFLARE_API_KEY=... -e CLOUDFLARE_EMAIL=... -e CLOUDFLARE_ACCOUNT_ID=... pesaswap-merchant-app sh -lc 'npm run build && npx --yes wrangler@latest deploy'`.
5. **Rebuild the prod-local mirror** so `:8787` reflects the new code:
   `docker compose -f docker-compose.prod.yml up -d --build merchant-app-prod`.
   The image runs `scripts/bundle-prodlocal.mjs` after the build to emit a single
   self-contained `dist/server/worker.single.js` and serves it with `wrangler dev
   --no-bundle`. This is required because the route-split build re-exports shared
   constants from the worker entry (`export { INSTANT_PAYOUT_PERCENT as I, … }`),
   which newer workerd rejects as invalid named entrypoints ("Incorrect type for
   map entry 'I'"). Do **not** revert the prod CMD to a plain `wrangler dev` — it
   crash-loops. The shared `dist/` used by `wrangler deploy` is untouched.
6. **Verify** the feature on **all three tiers** (curl/UI): `localhost:8080`,
   `localhost:8787`, and the Cloudflare URL.
7. **Commit + push**.

## Skill / agent expectation
Every `SKILL.md` and every `*-engineer` agent carries a "Definition of Done — full
parity" note pointing here. When a subagent builds a feature function, "done"
means this checklist is satisfied — not merely that the code compiles.

## Sandbox environment (test payments)
Alongside production there is a **sandbox** Worker built from the SAME codebase,
so partners can try the full journey with no real money:

| | Production | Sandbox |
| --- | --- | --- |
| URL | `pesaswap-merchant-app.pesaswap.workers.dev` | `pesaswap-merchant-app-sandbox.pesaswap.workers.dev` |
| Payments | live M-Pesa (`PAYMENTS_TEST_MODE=0`) | simulated (`PAYMENTS_TEST_MODE=1`) |
| Database (Neon) | `neondb` (Hyperdrive `37e129fb…`) | `pesaswap_sandbox` (Hyperdrive `f9c735c4…`) |
| Deploy | `wrangler deploy` | `wrangler deploy --env sandbox` |

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
