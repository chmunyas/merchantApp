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
2. **Migrations** — apply every new `db/NN-*.sql` to **all three** databases:
   - dev: `docker exec pesaswap-postgres psql -U pesaswap -d pesaswap -f /docker-entrypoint-initdb.d/NN-*.sql`
   - prod-local: `docker exec pesaswap-postgres-prod psql -U pesaswap -d pesaswap -f /docker-entrypoint-initdb.d/NN-*.sql`
   - Neon: `docker run --rm -v <repo>\db:/db postgres:16 psql "<neon-direct-url>" -f /db/NN-*.sql`
   Do **not** put semicolons inside SQL comment lines (the local splitter breaks on them).
3. **Register** any new route handler in `src/server.ts`. A build regenerates
   `src/routeTree.gen.ts` for new route files.
4. **Build + deploy** from **inside** the container (host `node_modules` is empty):
   `docker exec -w /app -e CLOUDFLARE_API_KEY=... -e CLOUDFLARE_EMAIL=... -e CLOUDFLARE_ACCOUNT_ID=... pesaswap-merchant-app sh -lc 'npm run build && npx --yes wrangler@latest deploy'`.
5. **Rebuild the prod-local mirror** so `:8787` reflects the new code:
   `docker compose -f docker-compose.prod.yml up -d --build merchant-app-prod`.
6. **Verify** the feature on **all three tiers** (curl/UI): `localhost:8080`,
   `localhost:8787`, and the Cloudflare URL.
7. **Commit + push**.

## Skill / agent expectation
Every `SKILL.md` and every `*-engineer` agent carries a "Definition of Done — full
parity" note pointing here. When a subagent builds a feature function, "done"
means this checklist is satisfied — not merely that the code compiles.
