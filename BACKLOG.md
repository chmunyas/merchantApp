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
- ✅ **DONE** **Provider webhook signatures** — inbound is signature-verified per
  channel, gated on each secret: WhatsApp + Instagram `X-Hub-Signature-256`
  (`WHATSAPP_APP_SECRET`/`INSTAGRAM_APP_SECRET`), Telegram
  `X-Telegram-Bot-Api-Secret-Token` (now also **registered** on `webhook/set` so
  Telegram actually sends it), SMS/bridge shared secret. See
  `src/lib/webhook-verify.ts`, `src/api/channels.ts`, `src/api/whatsapp.ts`.
- ✅ **DONE** Configurable **CORS** origin — `src/lib/cors.ts` + a single rewrite in
  `server.ts` `withSecurityHeaders`. Set `CORS_ALLOWED_ORIGIN` (single origin,
  comma-list, or `*`) to lock cross-origin access; unset keeps the open default.
- ✅ **DONE (partial)** Rate limiting: **per-account** limits added
  (`enforceAccountRateLimit`/`isAccountRateLimited` in `src/lib/rate-limit.ts`;
  applied to `/api/copilot` 30/min and `/api/broadcast` 6/min per venue).
  **Remaining P2:** WAF/bot rules + a CAPTCHA on signup (Cloudflare/infra).
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
- ✅ **DONE (API)** Dispute / chargeback **response tooling** — `db/49` adds
  `evidence`/`evidence_submitted_at`/`resolution`; `POST /api/disputes/:id/evidence`
  (contest → `under_review`) and `POST /api/disputes/:id/accept` (concede) gated
  manager+. **Remaining P3:** a dashboard page to drive it (the API + agent can
  already act).
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
  Postgres, principal-scoped (merchant → member stores, reseller admin → org venues,
  admin → all). The dashboard picker consumes it (additive; falls back to the local
  list offline). `src/api/venues.ts`.
- ✅ **DONE (multi-store)** One login can own **multiple stores** — `user_venues`
  membership (`db/42`), `POST /api/venues` "add a store" (plan-capped),
  `POST /api/auth/switch-venue` re-mints the JWT for a member store (server-verified),
  and a store switcher + "Add a store" in the dashboard picker. Each store is fully
  isolated; a user can never switch into a store they don't own.
- ✅ **DONE (store roles + team)** Owner/manager-per-store — `GET/POST/DELETE
  /api/venues/members` (`src/api/multistore.ts`) with per-store RBAC: a manager+
  may invite/re-role/remove members up to their own rank (no privilege
  escalation), find-or-creates the invitee's `app_users` row, is plan-capped on
  team size, and never orphans a store's last owner. Surfaced at `/dashboard/team`.
- ✅ **DONE (chain rollup)** `GET /api/venues/rollup` aggregates net/gross/tips/
  refunds/txns across every store the login manages (last 30 days), rendered at
  `/dashboard/chain`. Revenue is only shown for stores where the caller is
  manager+, so a staff-level membership never leaks another store's takings.
- ✅ **DONE (multi-venue staff)** A staff member's per-venue `staff` rows are linked
  by phone, so one PIN login can list (`GET /api/staff/my-venues`) + switch
  (`POST /api/auth/staff-switch-venue`, re-mints the staff JWT, verified same-phone
  + active there) between every store they work at — store switcher on
  `/staff-console`. Switching to an unassigned store is 403.
- ✅ **DONE (order lifecycle notifications)** On a real status change to accepted /
  preparing / ready, `PATCH /api/orders/:id` notifies the customer on their channel
  (consent-checked, timeline-logged), fulfillment-aware (eat-in vs collection) with
  the scheduled time — `src/lib/order-notify.ts`. Customers can ask "where's my
  order?" via the agent's `get_order_status` tool.
- ✅ **DONE (venue-aware inbound)** Inbound is routed to the venue that owns the
  receiving channel account (`channel_accounts`, `db/44`) via
  `resolveVenueForAccount` — a customer messaging store A's WhatsApp number reaches
  store A's agent/menu/orders (falls back to `main`). Payments + orders are already
  `venue_id`-scoped in the DB, so each store's transactions are fully separated.
- ✅ **DONE (per-venue outbound config)** Each store sends on its OWN number/bot —
  channel config is namespaced `whatsapp_cloud:<venue>` / `telegram:<venue>` (global
  default fallback, no migration), `getWhatsappConfig/getTelegramConfig(env, venue)`
  and `adapter.send(handle, text, env, venue)` thread the venue through every
  outbound path (agent reply, order notify, share, campaigns, sequences, invoices,
  reminders, DLQ, staff reply). The agent's free-form reply names the specific store.
  **Remaining (external creds only, can't build/test without accounts):** TikTok + X
  (Twitter) adapters; live keys for SMS (Africa's Talking + 10DLC), Email
  (Resend/SendGrid), and per-venue WhatsApp/Telegram numbers. The Baileys bridge is
  single-account (one WhatsApp number) — multi-venue uses Cloud API webhooks.
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
- ✅ **DONE (P1)** **Apply branding to surfaces** — the dashboard shell shows the
  reseller/bank brand (not hardcoded "PesaSwap") and the **pay page** shows the
  merchant's logo/name via `useBranding(venue)` (public), keeping a "Powered by
  PesaSwap" attribution.
- ✅ **DONE (P1)** **Bank-admin portal** — `/reseller` onboards/lists merchants +
  edits org branding, **plus aggregate analytics + revenue-share**: `db/45`
  `organizations.commission_bps`, `GET /api/org/analytics` (processed volume + tx
  per merchant + the reseller's commission), rendered as stat cards + per-merchant
  Gross/Commission columns.
- ✅ **DONE** **Org-scoped login** — login carries the `org` claim + `reseller_admin`
  role (`src/api/auth.ts`); `getDefaultRouteForRole` routes them to `/reseller`;
  RBAC separates reseller vs merchant. Verified: a reseller admin logs in and lists
  only their org's merchants.
- ✅ **DONE (co-branded signup)** `/get-started?org=<slug>` reads `GET /api/org`,
  shows the reseller's brand (logo + "{bank} × PesaSwap"), and links the new
  `venue.org_id` to the org on signup (`signup({..., org})`). **Invite-token flow
  DONE:** `db/46` `org_invites` + `organizations.require_invite`; invite-only orgs
  reject open signups (403) until a valid unused unexpired token is supplied
  (`POST/GET /api/org/invites`, portal "Invite links" section). Verified live:
  open→403, valid invite→201, reuse→403.
- ✅ **DONE (P2)** **Reseller settlement + commission ledger** — `db/47`
  `commission_ledger`; `src/lib/commission.ts` posts the org's revenue share once
  per succeeded payment (idempotent on `payment_id`), and `handleCreatePayment`
  tags `settlement_partner_id` from `organizations.pesaswap_partner_id` so a bank's
  merchants settle under its PesaSwap partner. `GET /api/org/ledger` + a
  "Commission posted" portal stat. Verified live: KES 600 (3% of 20,000) posted.
- ✅ **DONE (per-merchant manifest)** + **P2** **Logo storage** — a dynamic
  `GET /api/manifest?venue=|org=` (`src/api/manifest.ts`) serves each merchant a
  branded installable app (name/colour/logo icon); `__root.tsx` points at it and
  swaps in the logged-in venue. **Remaining:** move inline data-URL logos (≤512KB)
  to Cloudflare R2 / Images (needs an R2 binding).

## Testing & CI
- ✅ **DONE** **E2E job in CI** — runs the HTTP + Playwright suites against the
  ephemeral Postgres service; green on GitHub Actions (curl health-poll on
  127.0.0.1 instead of wait-on).
- **P2** Add **branch protection** on `main` requiring `CI / quality` + `CI / E2E`.
- ✅ **DONE** More **integration/E2E** coverage (payment webhook, campaigns, DLQ)
  — `__tests__/unit/payment-ledger.test.ts` proves a signed `payment_failed`
  webhook is written to the ledger with its decline reason (and an unsigned one
  never is); `__tests__/e2e/payments-campaigns-dlq.e2e.ts` drives a DECLINED +
  a SUCCESSFUL payment (`PAYMENTS_TEST_MODE`, `metadata.simulate="failed"`),
  asserts both are recorded + distinct in `/api/payments/list`, and smokes
  broadcast/campaign history + the tenant-scoped DLQ (list + retry).

## Omnichannel channels (see `.claude/skills/omnichannel-agent/`)
- ✅ **DONE** Enforce **consent + suppression in code** — the `suppressions` table
  + `src/lib/consent.ts` (STOP/START/HELP detection, `isSuppressed`/`setSuppressed`)
  are now honoured on **every** outbound path: inbound auto-opt-out + agent reply
  (`inbound.ts`), single merchant sends (`share.ts`), **bulk campaigns**
  (`lib/broadcast.ts`), **drip sequences** (`lib/sequences.ts`, opt-out halts the
  drip) and **DLQ retries** (`api/dlq.ts`). STOP → suppressed + transactional
  confirmation; suppressed contacts never receive unsolicited outbound.
- **P2** Build the **to-build adapters** following the `parseInbound`/`send`/
  `verifyWebhook` pattern:
  - ✅ **Email** — DONE (`src/lib/channels/email.ts`): inbound-parse webhook
    (`/api/email/inbound`, SendGrid/Mailgun shapes) → agent → reply; outbound via
    **Resend** or **SendGrid**, gated on `EMAIL_FROM` + `RESEND_API_KEY`/
    `SENDGRID_API_KEY` (simulated without keys). Marketing draws from `contacts.email`.
  - **TikTok** — via a Business Solution Provider; inbound-only, region-gated. *(needs BSP creds)*
  - **X (Twitter)** — API v2 DMs, paid tier, eligibility + rate-limit back-off. *(needs paid API)*
- **P2** **Instagram**: wire the Meta webhook + page token; enforce the 24h / 7-day
  Human-Agent-Tag / message-tag rules in `send`.
- **P2** **SMS**: STOP/HELP auto-replies are enforced (shared consent pipeline) and
  **quiet hours** gate marketing sends (`SMS_QUIET_START`/`SMS_QUIET_END` +
  `SMS_TZ_OFFSET_MIN`, default EAT; `src/lib/quiet-hours.ts`). Still needs
  **10DLC/TCR** registration (carrier, external) before a US outbound campaign.
- **P2** **A2A hardening**: ✅ **peer allowlist** (`A2A_PEER_ALLOWLIST`) +
  **capability scoping** by caller (customer vs staff, returned in the response) +
  signed intents (agent-intent) + ✅ **rotating signed peer tokens**
  (`A2A_PEER_SECRET`; `x-agent-signature` = HMAC over `${agentId}.${ts}`, 5-min
  window — grants trusted scope without a static shared key). Remaining: mTLS
  (not available on Workers).
- ✅ **DONE** Cross-channel **consent-to-switch** logging when moving a customer to
  a new channel — `db/48` `consent_switch_log`; `src/api/share.ts` `logConsentSwitch`
  records `(channel, from_channel, kind)` on every merchant-initiated share,
  detecting the customer's last-seen channel from `conversations.channel`. Verified
  live (dev + prod-local): an SMS share to a WhatsApp-last-seen handle logs
  `from_channel='whatsapp'`.

## Integrations & config
- **P2** **Google sign-in**: set `GOOGLE_CLIENT_ID` (+ optional
  `GOOGLE_ALLOWED_EMAILS`) to activate the button.
- **P2** Set `app_settings.public_base_url` to a stable domain (the cloudflared
  quick tunnel is ephemeral) so pay links are durable.

## PWA
- **P3** Replace the placeholder install-listing **screenshots**
  (`public/screenshots/*.png`, generated by `scripts/gen-screenshots.mjs`) with real
  captures. *(needs real device captures)*
- ✅ **DONE** Post-onboarding **setup checklist** on the dashboard overview
  (`OnboardingChecklist`) — add a menu item, set the M-Pesa till, add branding,
  invite a team member, set up tables/QR; completion derived from the merchant's
  own data, per-venue dismissible, only shows for a real (non-demo) venue.
