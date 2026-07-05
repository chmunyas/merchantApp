# Deployment & Scale Guide

How PesaSwap Merchant App is deployed to Cloudflare, and the recommended
settings to run it reliably at scale. The database is **always PostgreSQL**;
the edge runtime is **Cloudflare Workers**.

## 1. Current production topology

```
Browser / PWA
   │  HTTPS
   ▼
Cloudflare Worker  (pesaswap-merchant-app)      ← global, auto-scaling
   │  env.HYPERDRIVE.connectionString
   ▼
Cloudflare Hyperdrive  (id 37e129fb…, caching disabled)   ← edge connection pool
   │  TLS (sslmode=require)
   ▼
Neon PostgreSQL  (direct endpoint, us-east-1)   ← single source of truth
```

- **Live URL:** https://pesaswap-merchant-app.pesaswap.workers.dev
- **Static assets** (`dist/client`, 159 files) are served from Cloudflare's edge
  cache; the Worker (`dist/server/server.js`) runs SSR + the `/api/*` handlers.
- **Bindings:** `HYPERDRIVE` (Postgres), `PESASWAP_URL` (var).
- **Secrets** (via `wrangler secret put`): `JWT_SECRET`, `ADMIN_PASSWORD`.
  Optional for live payments: `PESASWAP_API_KEY`, `PESASWAP_WEBHOOK_SECRET`.

## 2. Build & deploy

`wrangler deploy` re-bundles the Worker with esbuild, so it needs
`node_modules`. The host uses a **container-only** `node_modules` volume, so
build **and** deploy run inside the app container:

```powershell
# Build (writes dist/ to the bind-mounted repo)
docker exec -w /app pesaswap-merchant-app npm run build

# Deploy (Global API Key auth; a scoped token is better for automation — see §7)
docker exec -w /app `
  -e CLOUDFLARE_API_KEY="<key>" -e CLOUDFLARE_EMAIL="<email>" `
  -e CLOUDFLARE_ACCOUNT_ID="e3e8622d30d13df73a95bd6db07ad9a7" `
  pesaswap-merchant-app npx --yes wrangler@latest deploy
```

Schema migrations (run on any DB change, ordered by filename):

```powershell
docker run --rm -v D:\Demo\merchantApp\db:/db postgres:16 sh -c \
  'for f in /db/*.sql; do psql "$NEON_DIRECT_URL" -v ON_ERROR_STOP=1 -f "$f"; done'
```

## 3. Why it scales

- **App tier:** Workers run one isolate per request across Cloudflare's global
  network — effectively unlimited horizontal scale, no servers to manage.
- **The bottleneck is the database.** Two things protect it:
  - **Hyperdrive** pools + reuses origin connections at the edge, so thousands
    of concurrent isolates do **not** open thousands of Postgres connections.
  - **Neon** autoscales compute and provides its own pooler for spikes.
- The app already scopes a **fresh Postgres client per request** via
  `withRequestSql` (AsyncLocalStorage) so sockets never cross requests on
  Workers — the correct pattern; do not reintroduce a module-level client.

## 4. Recommended production settings

| Area | Recommendation |
|------|----------------|
| **Custom domain** | Move off `*.workers.dev`: add a route in `wrangler.toml` (`routes = [{ pattern = "app.pesaswap.io", custom_domain = true }]`) and set `workers_dev = false`. |
| **Preview URLs** | Set `preview_urls = false` in `wrangler.toml` for prod so unreleased versions aren't publicly reachable. |
| **Neon compute** | Disable scale‑to‑zero (or set a floor) for latency‑sensitive prod — avoids ~0.5s cold starts. Right‑size compute; enable **PITR backups**. |
| **Hyperdrive caching** | Currently **disabled** for correctness (live merchant/payment data). For read‑heavy public pages (menu, pay links) consider a **second** Hyperdrive config *with* caching for those specific read queries, keeping writes/admin on the uncached one. |
| **Read scaling / multi‑region** | Add Neon **read replicas** + a Hyperdrive config per replica; route read‑only queries to replicas. |
| **Security headers** | Add CSP, HSTS, `X‑Content‑Type‑Options: nosniff`, `Referrer‑Policy`, `X‑Frame‑Options` centrally in `src/server.ts`. |
| **CORS** | `/api/*` currently returns `Access-Control-Allow-Origin: *`. Restrict to known origins (your domain) in production. |
| **Edge WAF / rate limiting** | The app rate‑limits sensitive endpoints (`src/lib/rate-limit.ts`); add Cloudflare WAF + rate‑limiting rules for defense in depth. |
| **Secrets** | Rotate any token shared in chat. Keep all runtime secrets in `wrangler secret`; never commit. Set `PESASWAP_*` when enabling live payments. |
| **Indexes** | Ensure `venue_id`/tenant columns are indexed on every large table for multi‑tenant query performance at scale. |

## 5. Observability

- `wrangler tail` — live production logs.
- Cloudflare **Workers Analytics** + **Logpush** (to R2/S3) for request metrics.
- Neon dashboard — connections, compute, query latency.
- Add an error tracker (e.g., Sentry) via the Worker's `console.error` path
  (`src/lib/error-capture.ts` already centralises captured errors).

## 6. Platform limits to design within

- Worker CPU time (paid plan raises the default 30s wall / CPU budget).
- Subrequests per request (50 free / 1000 paid) — batch external calls.
- Request/response body size limits — stream large payloads.
- Use `ctx.waitUntil()` for non‑blocking work (already used for connection
  cleanup); consider **Cloudflare Queues** for heavy async (webhooks, broadcasts).
- Enable the Workers **AI binding** (`[ai]` in `wrangler.toml`) in prod to move
  the ops agent off its rule‑based local fallback.

## 7. CI/CD (recommended next step)

Deploys are currently **manual** because the Global API Key is unsuitable for
CI. To enable auto‑deploy on push:

1. Create a **scoped API token**: `Account › Workers Scripts › Edit` +
   `Account › Hyperdrive › Read` (+ `Account Settings › Read`, `User › Memberships › Read`).
2. Set repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and
   `CLOUDFLARE_DEPLOY_ENABLED=true`.
3. The `deploy` job in `.github/workflows/ci.yml` runs `npm ci` (so
   `node_modules` is present) and then deploys — the gate opens automatically.

## 8. Cost snapshot

- **Workers:** free 100k req/day; paid from $5/mo (10M+ requests).
- **Hyperdrive:** free.
- **Neon:** free tier + usage‑based; a small always‑on compute for prod latency.
