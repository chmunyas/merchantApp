# PesaSwap Merchant App

[![CI](https://github.com/chmunyas/merchantApp/actions/workflows/ci.yml/badge.svg)](https://github.com/chmunyas/merchantApp/actions/workflows/ci.yml)

> **Branch protection (recommended):** in GitHub → Settings → Branches → add a
> rule for `main` requiring the **CI / quality** and **CI / E2E (PWA → back
> office)** status checks to pass before merging, so no PR merges with failing
> typecheck, lint, tests, or E2E flows.

A full-stack mobile-first payment platform built with React 19 + TanStack Start + Vite 7, deployed on Cloudflare Workers. Integrates [PesaSwap SDK](https://docs.pesaswap.io) for M-Pesa, card, Apple Pay, and Google Pay payments.

> **Production status:** **NO-GO for unrestricted live money movement or customer
> PII.** See [review.md](review.md) for the verified findings, ordered remediation
> programme, validation evidence, and release gates. A successful local build is
> not production approval.

## Enterprise programme

- [Production go-live capability contract](docs/PRODUCTION-GO-LIVE-CAPABILITIES.md) —
  required persona journeys, business capabilities, controls, devices, API/SDK,
  accessibility, global operations, four-runtime evidence and certification
  boundaries. It is the target contract, not a claim of current readiness.
- [Global enterprise roadmap](docs/GLOBAL-ENTERPRISE-ROADMAP.md) — phased target
  architecture and release gates for authority, operations, finance, partner API,
  Android mPOS, accessibility, localisation and resilience.
- [Global readiness review](docs/GLOBAL-READINESS-REVIEW.md) — current GO/NO-GO
  assessment by core function and device surface.

## ✨ Features

### Merchant Side

- **Tap & Go POS** — Numpad → QR generation → real-time payment confirmation
- **Table Service** — Table management, QR per table, split payments, tips tracking
- **Order Routing** — Kitchen/bar order queue with live status
- **Catalogue Management** — Items, prices, dietary tags, destinations
- **Invoice Creator** — Multi-currency, partial payments, FX lock, recurring
- **AI Intelligence** — Revenue forecast, smart staffing, anomaly detection, customer insights
- **Loyalty Program** — Auto-enroll, tiered points (Bronze→Platinum)
- **Reservations** — Table booking with capacity management

### Customer Side

- **`/pay`** — Scan QR → one-tap M-Pesa payment (8 seconds vs 2 minutes old way)
- **`/table`** — Scan table QR → view bill → split → tip → pay
- **Order at Table** — Browse menu, place orders routed to kitchen/bar
- **Multi-language** — English, Swahili, French (auto-detected)

### Payments (PesaSwap SDK)

- M-Pesa STK Push (zero-UI for returning customers)
- Card payments via HyperLoader widget
- Apple Pay / Google Pay
- Full refund flow with item-level granularity
- Real-time WebSocket notifications to merchant
- Idempotency protection (no double charges)
- Server-side payment verification
- Server-bound, single-use payment intents; client amount/tenant metadata is not authority
- Atomic payment events with fenced, replay-safe accounting and commerce consumers
- Durable refund-capacity reservation and append-only proportional reversals

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Clone the repo
git clone https://github.com/chmunyas/merchantApp.git
cd merchantApp

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your PesaSwap keys (get them from https://app.pesaswap.io)

# Start development server
npm run dev
```

App runs at `http://localhost:5173/`

### Environment Variables

| Variable                                                     | Description                                                                   | Required   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------- |
| `VITE_PESASWAP_PUBLISHABLE_KEY`                              | Client-side publishable key (starts with `pk_`)                               | ✅         |
| `PESASWAP_API_KEY`                                           | Server-side secret key (starts with `prd_` or `snd_`)                         | ✅         |
| `PESASWAP_URL`                                               | API endpoint (`https://api.sandbox.pesaswap.io` or `https://api.pesaswap.io`) | ✅         |
| `VITE_BACKEND_URL`                                           | Your deployed backend URL (empty for local)                                   | Optional   |
| `PESASWAP_WEBHOOK_SECRET`                                    | Webhook signature verification secret                                         | Production |
| `APP_ENV`                                                    | `development`, `sandbox`, or `production`                                     | Production |
| `AUTH_REQUIRE_LOGIN`                                         | Must be `1` in production                                                     | Production |
| `AUTH_OTP_DEBUG` / `ALLOW_SIMULATORS` / `PAYMENTS_TEST_MODE` | Must be `0` in production                                                     | Production |

---

## 📁 Project Structure

```
src/
├── api/
│   └── payments.ts          # Server API routes (create payment, refund, webhook, status)
├── components/
│   └── merchant/
│       └── MerchantApp.tsx   # Main merchant app (~5000 lines, all merchant logic)
├── lib/
│   ├── pesaswap-payments.ts # Payment service layer (SDK integration)
│   ├── realtime.ts          # WebSocket real-time notifications
│   ├── utils.ts             # Shared utilities
│   ├── error-capture.ts     # Error tracking
│   └── error-page.ts        # Error page renderer
├── routes/
│   ├── __root.tsx           # Root layout (sidebar bypass for /pay, /table)
│   ├── index.tsx            # Home → MerchantApp
│   ├── pay.tsx              # Customer Tap&Go payment page
│   └── table.tsx            # Customer table payment page
├── server.ts                # Cloudflare Worker entry (routes API + SSR)
├── router.tsx               # TanStack Router config
├── routeTree.gen.ts         # Generated route tree
└── styles.css               # Tailwind CSS 4 styles

__tests__/
├── TEST-PLAN.md             # 146-test plan across 16 modules
├── unit/                    # Unit tests (Vitest)
└── e2e/                     # E2E specs (Playwright)

test-utils/
├── seed-data.ts             # Factory functions for test data
└── localStorage-mock.ts     # Mock for Vitest
```

---

## 🔌 Payment Integration Architecture

```
Customer Device          Your Backend (CF Worker)       PesaSwap Engine
─────────────────       ──────────────────────────     ────────────────
/pay              ────→  Resolve server source/intent
                  ────→  POST /api/payments/create ──→  POST /payments
                  ←────  { client_secret }          ←──  { payment_id }

HyperLoader SDK   ────→  (direct to PesaSwap)      ──→  Process payment
                  ←────  { status: succeeded }      ←──  Confirm

                         POST /api/webhooks/pesaswap ←── payment.succeeded
                         → Commit payment + financial event/outbox
                         → Replay-safe accounting/order/loyalty consumers
                         → WebSocket → merchant notification (1-3s)
```

### Payment Flows

| Scenario            | Flow                                   | Clicks     |
| ------------------- | -------------------------------------- | ---------- |
| M-Pesa (KES < 150K) | STK push to phone → confirm on handset | **1 tap**  |
| Returning customer  | Saved method → auto-confirm            | **1 tap**  |
| New card customer   | Full checkout widget                   | **3 taps** |

---

## 🧪 Testing

```bash
# Unit tests
npx vitest run

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

See `__tests__/TEST-PLAN.md` for the full 146-test plan covering all personas.

---

## 🏗️ Build & Deploy

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview

# Deploy to Cloudflare Workers
npx wrangler deploy
```

---

## 👥 Developer Personas & Routes

| Persona          | Primary View       | Key Features                               |
| ---------------- | ------------------ | ------------------------------------------ |
| Merchant/Owner   | `/` (home)         | Dashboard, invoices, AI insights, settings |
| Server/Waiter    | Tables tab         | Table management, payments, tips           |
| Kitchen Staff    | Orders Queue       | Incoming orders, prep status, completion   |
| Bar Staff        | Orders Queue (bar) | Drink orders, cocktail queue               |
| Host             | Reservations       | Table assignments, walk-ins, booking       |
| Dine-in Customer | `/table?t=<qr>`    | View bill, split, tip, order, pay          |
| Retail Customer  | `/pay?tapgo=<qr>`  | Scan QR, confirm, M-Pesa pay               |
| Ops Manager      | AI tab             | Forecasts, staffing, anomalies             |

---

## 📝 Key Technical Notes

- **State management**: localStorage-based (keys: `fxengine.merchant.*`)
- **Route bypass**: `/pay` and `/table` render without sidebar
- **QR format**: Base64-encoded JSON in URL param (`?t=<base64>` or `?tapgo=<base64>`)
- **Audio alerts**: Web Audio API (880Hz sine wave) for payment notifications
- **Auto-close**: Tables auto-close when `paidAmount >= total`
- **Multi-language**: Auto-detect from `navigator.language`, manual toggle EN/SW/FR

---

## 🔑 API Endpoints

| Method          | Path                                            | Description                                          |
| --------------- | ----------------------------------------------- | ---------------------------------------------------- |
| POST            | `/api/payments/create`                          | Create payment intent                                |
| GET             | `/api/payments/:id/status`                      | Check payment status                                 |
| POST            | `/api/refunds`                                  | Manager+ refund; API tokens require `payments:write` |
| GET             | `/api/customers/payment-methods`                | Get saved payment methods                            |
| POST            | `/api/webhooks/pesaswap`                        | Receive payment events                               |
| GET             | `/api/notifications`                            | Poll notifications (fallback)                        |
| WS              | `/api/realtime`                                 | WebSocket for real-time events                       |
| GET             | `/api/health`                                   | Cloud backend + Postgres health                      |
| GET/POST        | `/api/contacts`                                 | CRM contacts (PostgreSQL)                            |
| POST            | `/api/ai/command`                               | Natural-language ops query                           |
| GET/POST        | `/api/whatsapp/webhook`                         | WhatsApp Cloud API verify + receive                  |
| POST            | `/api/whatsapp/simulate`                        | Drive the agent locally (no Meta account)            |
| GET             | `/api/whatsapp/conversations`                   | List inbox threads                                   |
| GET             | `/api/whatsapp/messages`                        | Messages in a thread                                 |
| POST            | `/api/whatsapp/reply`                           | Staff takes over from the AI                         |
| POST            | `/api/chat`                                     | In-app web-chat message (channel = web)              |
| GET             | `/api/chat/messages`                            | Web-chat thread for a session                        |
| GET             | `/api/push/vapid`                               | Public VAPID key for the PWA                         |
| POST            | `/api/push/subscribe`                           | Register a Web Push device                           |
| GET             | `/api/push/latest`                              | Latest notification (service worker)                 |
| POST            | `/api/channels/simulate`                        | Drive any channel's pipeline (test)                  |
| GET/POST        | `/api/telegram/webhook`                         | Telegram Bot API webhook                             |
| GET/POST        | `/api/instagram/webhook`                        | Instagram (Meta Graph) webhook                       |
| POST            | `/api/sms/inbound`                              | Inbound SMS (Africa's Talking)                       |
| POST            | `/api/broadcast`                                | Segmented bulk send across a channel                 |
| GET             | `/api/broadcast/history`                        | Broadcast delivery stats                             |
| GET             | `/api/timeline`                                 | Cross-channel history for a person                   |
| GET/POST        | `/api/dlq` `/api/dlq/retry`                     | Failed deliveries + retry                            |
| GET/POST/DELETE | `/api/kb` `/api/kb/search`                      | Knowledge base (RAG)                                 |
| GET             | `/api/analytics/agent`                          | Agent & channel performance                          |
| GET/POST        | `/api/sequences` `/api/sequences/run`           | Drip sequences                                       |
| GET             | `/api/ai/provider` · POST `/api/ai/transcribe`  | AI provider status / Whisper                         |
| GET/POST        | `/api/invoices`                                 | Omnichannel invoicing + pay link                     |
| POST            | `/api/a2a` · GET `/.well-known/agent-card.json` | Agent-to-agent (A2A)                                 |

---

## 🌐 Omnichannel core

Every channel flows through **one pipeline** (`src/lib/inbound.ts`) behind a
uniform `ChannelAdapter` (`src/lib/channels/`, Omni's plugin pattern) — so the
Inbox, identity graph, and AI agent never special-case a provider. Adding a
channel is one adapter file + one line in the registry.

- **Channels today:** WhatsApp (Cloud API + Baileys QR bridge), in-app **web
  chat**, **Telegram** (Bot API — connect at Dashboard → Telegram, long-polling
  via the bridge locally or a webhook in production), **Instagram** (Meta Graph)
  and **SMS** (Africa's Talking) — all the same agent, dedupe, escalation and
  persistence. Each is one adapter file in `src/lib/channels/`; add another with
  zero pipeline changes.
- **Web chat widget:** a floating chat on every customer touchpoint (`/pay`,
  `/table`, `/book`, `/enquire`, `/merchant`) — anonymous session, zero cost,
  same booking agent.
- **Identity graph:** `persons` + `platform_identities` collapse the same human
  across channels (auto-linked by phone) — the **Contacts → History** modal shows
  one unified WhatsApp + SMS + web + Telegram timeline per customer.
- **Broadcasts:** segmented (all / gold+ / lapsed), per-recipient personalized
  (`{{name}}`, `{{venue}}`), dispatched across a channel from **Automations →
  Campaigns**, with delivery stats — a capability Omni defers.
- **Inbound dedupe + event log:** `events` table makes webhook delivery
  idempotent (retries never double-post) and replay-able.
- **Reliability:** failed sends land in a **dead-letter queue**
  (`events.status = 'failed'`) with a one-tap retry (`/api/dlq/retry`).
- **Web Push:** VAPID keys are generated once and persisted in Postgres
  (`app_settings`); staff tap **Enable alerts** in the Inbox. Override with
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_JWK` in production.
- **Optional API key:** set `OMNI_API_KEY` to gate machine/admin endpoints
  (off by default — the app is unaffected).

Channel credentials are optional only when the channel is disabled. Production
ingress fails closed without its configured provider/shared secret; simulators
exist only when explicitly enabled outside production:
`TELEGRAM_BOT_TOKEN`, `INSTAGRAM_TOKEN` / `INSTAGRAM_VERIFY_TOKEN`,
`AT_API_KEY` / `AT_USERNAME` / `AT_SENDER_ID`.

Migrations: `db/04-omnichannel.sql`, `db/05-intelligence.sql`, `db/06-invoices.sql`
(all additive, idempotent).

---

## 🧠 Intelligence & CRM (P2)

- **Multi-provider AI** (`src/lib/ai-providers.ts`): the agent's free-form
  replies and `/api/ai/command` run through OpenAI-compatible, Anthropic, **local
  Ollama** (open-source models), or Cloudflare Workers AI — with an automatic
  fallback chain and circuit breaker. Configure with `AI_PROVIDER` +
  `OPENAI_API_KEY`/`OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, or `OLLAMA_BASE_URL`.
- **Knowledge Base + RAG** (**Dashboard → Knowledge**): the agent answers FAQs
  from the merchant's own articles across every channel — pgvector cosine search
  in production, full-text/word-match locally. Seeded with hours, parking, wifi,
  dietary, cancellation and private-events answers.
- **Voice notes**: `/api/ai/transcribe` (Whisper via Workers AI or OpenAI/Groq).
- **Sequences** (drip follow-ups): `sequences` + `sequence_enrollments`; enrol a
  recipient and `POST /api/sequences/run` sends due steps across the channel.
- **Agent analytics** (**Dashboard → Analytics**): conversations by channel, AI
  vs human automation rate, escalation rate, tool usage, broadcasts.
- **Invoices ↔ omnichannel** (**Dashboard → Invoices**): a full accounting-grade
  billing suite — **line items + VAT/tax**, **due dates**, a Tap & Go **pay link**
  - **QR code**, delivery over any channel, **partial payments**, **status**
    (draft/sent/partial/overdue/paid/void), a per-invoice **activity/audit trail**,
    **automatic payment reminders**, and **recurring invoices** (subscriptions /
    retainers). Reminders and recurring billing run themselves 24/7 via the bridge
    sweep (`/api/invoicing/run`); receivables stats show outstanding/overdue/
    collected. The agent also creates invoices by chat — "invoice +2547… 2500".
- **A2A**: `POST /api/a2a` + `/.well-known/agent-card.json` let external agents
  drive the CRM in natural language.

Migrations: `db/04`–`db/08` (all additive, idempotent).

---

## 💬 WhatsApp AI Agent

A 24/7 WhatsApp assistant that books tables and gives staff full CRM control by
text. **Connect your business line two ways** (Dashboard → **WhatsApp**):

- **Link by QR (quick start)** — the optional `whatsapp-bridge/` service (Baileys)
  shows a QR; scan it from your phone (WhatsApp → _Linked Devices_) and the bot
  runs as your existing number. Session is persisted in PostgreSQL with
  keepalive + auto-reconnect + a stale watchdog. Start it with
  `docker compose up -d whatsapp-bridge`. ⚠️ Unofficial (WhatsApp ToS / ban risk).
- **Official Cloud API (production)** — enter token / phone-number-id / verify
  token in the dashboard wizard (saved to `app_settings`); stateless, compliant,
  no ban risk. Send order is **bridge → Cloud API → simulated**, so nothing
  breaks when neither is configured.

- **Customers** can book (`"book 6 tonight at 7"` → availability-checked enquiry).
- **Allowlisted staff/admin** numbers unlock CRM tools (`"covers today"`,
  `"new enquiries"`, `"top spenders"`).
- **Tool-loop + circuit breaker + escalate-to-human** with a Workers AI fallback.
- Manage it all from **Dashboard → Engage → Inbox**, including a built-in
  simulator that drives the exact same pipeline.

**What customers can do in natural language** (any channel):

- **Enquire / book** — "book 4 tonight at 8" → availability-checked reservation
- **See the menu & prices** — "show me the menu", "how much is nyama choma?"
- **Ask for a bill / pay** — "can I pay 3200?" → a Tap & Go pay link
- **FAQs** — parking, wifi, dietary, cancellation, private events (from the KB)
- **Reach a human** — "speak to a manager" → escalated in the Inbox

**Staff/allowlisted** can also run the CRM by text — "covers today", "top
spenders", "invoice +2547… 2500 for dinner". Drip **sequences** send themselves
24/7 (the bridge auto-runs due steps), and the assistant shows a **typing…**
indicator while it works.

Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, and `WHATSAPP_VERIFY_TOKEN` to send
real messages; without them the agent runs in simulate mode. Manage the staff
allowlist in the `wa_allowlist` table (`db/03-whatsapp.sql`).

**Connecting your line (Dashboard → WhatsApp):** the Cloud API card has a
**Test connection** button (verifies your token/phone-id against Meta) and an
**Active transport** selector — `auto` (bridge → Cloud API), `bridge` only, or
`cloud` only for production. Saved config lives in `app_settings`; note that in
production Hyperdrive caches reads, so a transport switch can take up to ~60s to
reflect in the UI (the write itself is immediate).

**Keeping the agent's menu current:** the **Menu** page has a _Sync to AI agent_
button that pushes your live catalogue to `menu_items` so the assistant quotes
real items and prices.

```bash
# Try it without any WhatsApp credentials:
curl -X POST http://localhost:8080/api/whatsapp/simulate \
  -H "content-type: application/json" \
  -d '{"from":"+254712345678","name":"Guest","text":"book 4 tonight at 8"}'
```

---

## 🚀 Go-live (pilot)

The stack is pilot-ready for a small set of customers:

- **Public URL** — pay links, the pay page and webhooks need a public HTTPS
  origin. For a quick pilot, run a tunnel (`cloudflared tunnel --url
http://localhost:8080`) and set it once:
  `app_settings.public_base_url = { "url": "https://…" }` (the dashboard/agent
  build short links `…/pay?i=INV-XXX` from it). For production, `wrangler deploy`
  and set `PUBLIC_BASE_URL`. Dev/Vite needs the tunnel host in
  `vite.config.ts → vite.server.allowedHosts`.
- **Channels** — WhatsApp (QR bridge or Cloud API) and **Telegram** (Bot API,
  long-polling via the bridge) both live; web chat is built into the PWA. All
  route through one agent + one Postgres store, so the **PWA and back office share
  the same data** and changes sync (e.g. a web-chat message appears in the
  Inbox; an invoice is payable from the customer's phone).
- **Auth** — a secure **JWT** layer (`src/lib/jwt.ts`, HS256) with **PBKDF2**
  password hashing and `/api/auth/login` · `/api/auth/me` · `/api/auth/google` ·
  `requireAuth` guard. **Google sign-in** is built in (set `GOOGLE_CLIENT_ID`
  to activate the button; verified server-side via Google's tokeninfo, optional
  `GOOGLE_ALLOWED_EMAILS`). **Every staff mutation is JWT-enforced** — invoices,
  recurring, broadcasts, sequences, knowledge base, menu sync, inbox replies,
  channel/WhatsApp/Telegram config & simulators, DLQ retry and AI commands all
  require a token; the dashboard sends it via `authFetch`. Public/customer routes
  (`/pay`, web chat, payment create) and service routes (channel webhooks, the
  bridge `bridge/inbound`, and the `invoicing/run` · `sequences/run` sweeps) stay
  use their own opaque/customer trust boundary, while service routes require
  provider signatures or shared secrets. Development may obtain a demo token via
  `/api/auth/session`; production sets **`AUTH_REQUIRE_LOGIN=1`** and startup
  validation rejects an anonymous/debug/simulator posture.
  Admin credential + JWT secret live in `app_settings.auth` (override with
  `JWT_SECRET` / `ADMIN_EMAIL` / `ADMIN_PASSWORD`; default `admin@pesaswap.io` /
  `pesaswap-admin` — **change before real use**).
- **Shared state sync** — merchant/retail/services localStorage is mirrored to
  Postgres (`merchant_state`, via `/api/state`): `writeStorage` pushes on every
  save and the dashboard **hydrates from Postgres on load**, so the PWA and back
  office work off the same data and changes sync across devices.

---

## License

Private — PesaSwap © 2026
