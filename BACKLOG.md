# Backlog

Pending / follow-up work, flagged during development. Grouped by area with a rough
priority (P1 = before real go-live, P2 = soon after, P3 = nice to have). See
`SECURITY.md` for the security posture and `.claude/` for the domain skills/agents.

## Security & production readiness
- ✅ **DONE** Live **Cloudflare deploy** — Worker at
  `pesaswap-merchant-app.pesaswap.workers.dev` via Hyperdrive → Neon Postgres;
  strong `ADMIN_PASSWORD` + `JWT_SECRET` set; `AUTH_REQUIRE_LOGIN=1` on.
- ✅ **DONE (partial)** Sensitive read isolation — `requireAuth` on
  `/api/contacts`, `/api/invoices(+stats)`, `/api/whatsapp/conversations|messages`;
  non-admin tokens pinned to their venue.
- ✅ **DONE** **Read gating** — `requireAuth` now on `/api/state`, `/api/dlq`,
  `/api/analytics/agent`, `/api/kb`, `/api/recurring`; `/api/state` + invoice
  activity client calls moved to `authFetch`. (No more unauthenticated tenant reads.)
- **P1** **Provider webhook signatures** — verify `X-Hub-Signature-256` (WhatsApp)
  + Telegram/Instagram/SMS; require a shared secret on
  `/api/whatsapp/bridge/inbound` and `/api/invoicing/run` (Alert 7).
- **P2** Tighten **CORS** from `*` to the app origin once on a fixed domain.
- **P2** Rate limiting: per-account (not just per-IP) limits, WAF/bot rules, and a
  CAPTCHA on signup.
- **P2** **APM / error tracking** (e.g. Sentry) + uptime + alerting (only basic
  `console.error` capture today).
- **P2** **CI auto-deploy** — create a scoped API token (Workers Scripts:Edit +
  Hyperdrive:Read), set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_DEPLOY_ENABLED=true`
  (the Global API Key isn't suitable for CI); deploys are manual from the
  container today.
- **P2** Set `A2A_API_KEY` (or `OMNI_API_KEY`) to enable staff-scoped `/api/a2a`
  integrations — staff role is now gated behind it (anonymous callers run as
  `customer`).

## Payments & settlement
- **P1** Certified provider **sandbox → production credentials**; PCI-DSS SAQ-A
  attestation (keep: no PAN on the server; pay links to hosted checkout).
- ✅ **DONE** **Webhook signature verification** on `/api/webhooks/pesaswap` —
  reads the secret from the Worker `env` and rejects when unset/invalid
  (fail-closed). **Remaining P1:** set `PESASWAP_WEBHOOK_SECRET` + `PESASWAP_API_KEY`
  secrets to enable live payments (the webhook 503s until the secret is set).
- ✅ **DONE** Persist **webhook + refund + dispute** events — every trusted webhook
  is written to `payment_events` (audit trail + idempotency, `db/40`); refunds are
  booked to the ledger (`recordRefundRow`); **disputes/chargebacks** are upserted to
  `disputes` (`db/41`) from the payment's `disputes[]` or a dispute event, with
  `GET /api/disputes` + `GET /api/payment-events` reads. **Settlement/payout
  reconciliation** is live (`/api/settlement/*`, batches + fees/net + GL posting).
- **P2** Dispute / chargeback **response tooling** (submit evidence, accept) — the
  disputes are now recorded + surfaced via API; the merchant-facing evidence-upload
  UI + a provider "submit evidence" call remain.
- **P1 (external dependency)** **KE-QR interoperability — CBK-directory PSP id.**
  KE-QR codes (EMVCo MPM TLV, `src/lib/ke-qr.ts`) are structurally valid +
  CRC-verified but not yet routable by other banks until an acquiring-PSP
  identifier is issued from the CBK directory via **PesaSwap's PSP registration**.
  Until then the till is encoded under `ke.go.qr` with a placeholder account.
  **Ready:** it's an optional field in **Admin → Settings → KE-QR**
  (`app_settings('ke_qr').pspId`, `GET/PUT /api/ke-qr-config`, consumed by
  `PaymentQr` via `src/lib/ke-qr-config.ts`). Flipping in the real `pspId` is a
  runtime change — **no deploy required**. Action when issued: enter it there.

## Data model (server-authoritative migration)
- ✅ **DONE (staff, orders)** `staff` + `orders`/`order_items` are server-authoritative
  (`/api/staff`, `/api/orders`); `tips` attribution/pooling live (`/api/tips`,
  `payments.staff_id`+`tip_amount`, `tip_pools`, `tip_allocations`). **Reference pattern**.
- ✅ **DONE (settings/branding)** `venue_branding` (logo/colour/name) via `/api/branding`.
- ✅ **DONE (client per-venue isolation)** The merchant localStorage store is now
  namespaced to the logged-in venue (login pins `currentVenue` to the JWT claim); a
  real merchant (`v_*`) gets an EMPTY starter with their own business name instead of
  the shared "Sade's Atelier" demo (`createMerchantStarterData`, `isDemoVenue`,
  `getMerchantIdentity`). POS/KE-QR read the per-venue identity, not constants.
- ✅ **DONE (menus, tables)** `menu_items` + `dining_tables` are server-authoritative
  with per-row CRUD (`/api/menu/item`, `/api/tables`) and dedicated editors
  (`/dashboard/menu`, `/dashboard/tables`). `src/lib/server-sync.ts` mirrors both
  into the localStorage snapshot on dashboard entry + after each edit, so the
  read-only views (overview, floor plan, bookings, customer table) share one source
  of truth. Gated to real merchants (demo keeps its rich local showcase).
- ✅ **DONE (venues picker)** `GET /api/venues` serves the back-office picker from
  Postgres, principal-scoped (merchant → own venue, reseller admin → org venues,
  admin → all). The dashboard picker consumes it (additive; falls back to the local
  list offline). `src/api/venues.ts`.
- ✅ **DONE (sub-entity persistence)** Table combinations / zones / areas / floor-plan
  and menu modifiers / schedules already persist server-side per-venue via the
  `merchant_state` blob (`writeStorage` → `/api/state`, hydrated by
  `hydrateMerchantState`). **Deferred (P3, low value):** normalising these nested
  floor-plan / menu-decoration structures into dedicated per-row tables.

## Tenancy & billing (#5)
- ✅ **DONE (quota enforcement)** Per-plan caps are enforced on create (count vs cap
  → 402) for `recurring`, `staff`, `tables`, `menu_items` and `contacts`
  (`planLimit`/`planLimitMessage` in `src/lib/tenancy.ts`). Free-tier defaults:
  5 staff, 20 tables, 50 menu items, 25 recurring, 500 contacts. Demo/admin/pro
  tokens are uncapped; existing data is never touched.
- **P2** A real **billing processor** (Stripe/PesaSwap subscriptions: plan purchase,
  metering, dunning, upgrade/downgrade) + usage dashboards. Enforcement + the plan
  claim exist; the paid upgrade flow (moving a merchant from `free` → `pro`) does not.

## White-label & reseller (foundation shipped this session)
- ✅ **DONE** Reseller **org layer** — `organizations` + `venues.org_id` +
  `app_users.org_id`; `POST /api/org` (admin), `GET /api/org?slug` (public),
  `GET /api/org/merchants` (reseller admin); merchant signup accepts `?org=slug`.
- ✅ **DONE** Per-merchant **branding** — logo/colour/name persisted
  (`venue_branding`), `GET/PUT /api/branding`, Settings upload UI + reseller
  "powered by" co-brand.
- **P1** **Apply branding to surfaces** — consume `/api/branding` in the app shell
  (dashboard header/sidebar, currently hardcoded "PesaSwap") and public pages
  (pay link, booking/enquiry) so the merchant/bank brand actually shows.
- **P1** **Bank-admin portal UI** — a reseller dashboard to onboard/manage
  merchants, edit org branding, and see aggregate analytics + revenue share.
- **P1** **Org-scoped login** — a reseller-admin role + `org` claim on login (only
  merchant *signup* carries the org claim today); RBAC for reseller vs merchant.
- ✅ **DONE (co-branded signup)** `/get-started?org=<slug>` reads `GET /api/org`,
  shows the reseller's brand (logo + "{bank} × PesaSwap"), and links the new
  `venue.org_id` to the org on signup (`signup({..., org})`). **Remaining:** an
  invite-token flow (vs open slug signup).
- **P2** **Reseller settlement** — wire `organizations.pesaswap_partner_id` into
  payment creation so a bank's merchants settle under its PesaSwap partner, plus a
  revenue-share / commission ledger.
- **P2** **Logo storage** — move inline data-URL logos (≤512KB) to Cloudflare R2 /
  Images; **per-merchant PWA manifest + icons** for a branded installable app.

## Testing & CI
- ✅ **DONE** **E2E job in CI** — runs the HTTP + Playwright suites against the
  ephemeral Postgres service; green on GitHub Actions (curl health-poll on
  127.0.0.1 instead of wait-on).
- **P2** Add **branch protection** on `main` requiring `CI / quality` + `CI / E2E`.
- **P2** More **integration/E2E** coverage (payment webhook, campaigns, DLQ).

## Omnichannel channels (see `.claude/skills/omnichannel-agent/`)
- **P1** Enforce **consent + suppression in code**: a `consent`/suppression table +
  a check in `processInbound` before any outbound (compliance is documented but not
  yet enforced programmatically).
- **P2** Build the **to-build adapters** following the `parseInbound`/`send`/
  `verifyWebhook` pattern:
  - **Email** — ESP send + inbound-parse webhook, SPF/DKIM/DMARC, one-click
    `List-Unsubscribe`, suppression list.
  - **TikTok** — via a Business Solution Provider; inbound-only, region-gated.
  - **X (Twitter)** — API v2 DMs, paid tier, eligibility + rate-limit back-off.
- **P2** **Instagram**: wire the Meta webhook + page token; enforce the 24h / 7-day
  Human-Agent-Tag / message-tag rules in `send`.
- **P2** **SMS**: implement STOP/HELP auto-replies, quiet hours, and 10DLC/TCR
  registration before any outbound campaign.
- **P2** **A2A hardening**: signed tokens / mTLS / peer allowlist + capability
  scoping by caller on `POST /api/a2a`.
- **P3** Cross-channel **consent-to-switch** logging when moving a customer to a new
  channel.

## Integrations & config
- **P2** **Google sign-in**: set `GOOGLE_CLIENT_ID` (+ optional
  `GOOGLE_ALLOWED_EMAILS`) to activate the button.
- **P2** Set `app_settings.public_base_url` to a stable domain (the cloudflared
  quick tunnel is ephemeral) so pay links are durable.

## PWA
- **P3** Replace the placeholder install-listing **screenshots**
  (`public/screenshots/*.png`, generated by `scripts/gen-screenshots.mjs`) with real
  captures.
- **P3** First-run redirect to `/get-started` when not onboarded; a post-onboarding
  checklist (connect WhatsApp, add menu, take first payment).
