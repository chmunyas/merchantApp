---
name: omnichannel-agent
description: >-
  The AI assistant that converses with customers in natural language across
  WhatsApp, Instagram, Telegram, TikTok, Email, SMS and X (Twitter) — answering
  FAQs, showing the menu & prices, taking bookings, sending the bill and payment
  links, handing off seamlessly between channels and to human staff, speaking to
  the application through tools, and supporting agent-to-agent (A2A). Bounded by
  per-channel compliance and data-protection rules. Use for any task about the
  agent, inbound/outbound messages, channels/adapters, the bridge, web chat,
  cross-channel handoff, human escalation, A2A, opt-in/consent, or natural-language
  customer flows. Per-channel deep references live in `channels/`.
---

# Omnichannel AI agent

**One agent, one pipeline, one Postgres store, one customer identity** — every
channel routes through the same code, so the assistant behaves identically
everywhere, conversations continue across channels, and everything lands in the
back-office Inbox. This file is the hub; **deep per-channel detail lives in
[`channels/`](./channels/)** and the cross-cutting concerns in
[`handoff.md`](./handoff.md), [`a2a.md`](./a2a.md), [`compliance.md`](./compliance.md).

## The pipeline (how it all connects)
1. **Inbound** arrives via a channel adapter (webhook or the bridge) → normalized
   to `{channel, handle, platformUserId, name, text, providerMsgId}`.
2. `processInbound(message, venue, env)` (`src/lib/inbound.ts`) — the **single**
   entry point: identity-resolves the person, stores the conversation + message,
   then runs the agent.
3. **The agent** (`src/lib/agent.ts`) understands intent and **speaks to the
   application through tools** (see below), then produces a reply.
4. **Outbound** goes back on the customer's own channel via the adapter's `send`.

> Golden rule: add a capability **once** as an agent tool — it works on every
> channel automatically. Never special-case a channel in the agent.

## Speaking to the application (tools)
The agent doesn't guess — it calls real app functions and returns their result:
`get_menu` (menu skill), `create_enquiry` / `check_availability` (bookings),
`create_invoice` + `pay_link` (invoicing/payments), `request_payment` (ad-hoc
server-bound pay-link), `search_kb` (knowledge base), `get_todays_bookings` /
`count_enquiries` / `search_contacts` (CRM/analytics), `escalate_to_human`
(handoff). Tools are venue-scoped and reuse the same libs the dashboard uses, so
protecting the HTTP routes never breaks the agent. Add new capabilities as tools,
not prompt text.

## Channel matrix
Each channel has a reference in `channels/` with API mechanics, message types,
initiation rules, rate limits, opt-in and compliance. Summary:

| Channel | Initiation rule | Re-engage window | Business-initiated | Status |
| --- | --- | --- | --- | --- |
| [WhatsApp](./channels/whatsapp.md) | user msg opens 24h window | 24h free-form, else **approved templates** (marketing/utility/auth) | template + opt-in | **live** (Cloud API + Baileys bridge) |
| [Instagram](./channels/instagram.md) | user DM opens 24h | 24h; **Human-Agent-Tag** → 7d (manual only); message tags | limited (tags only) | adapter present |
| [Telegram](./channels/telegram.md) | user must `/start` the bot | none (no window) | only after /start (no cold DM) | **live** (Bot API poll/webhook) |
| [TikTok](./channels/tiktok.md) | **inbound only** (no cold DM) | per-partner window | ❌ not for cold outreach; region-restricted | **to build** (via BSP) |
| [Email](./channels/email.md) | consent | anytime with consent | yes (marketing needs opt-in) | **adapter present** (Resend/SendGrid; inbound-parse webhook) |
| [SMS](./channels/sms.md) | opt-in (TCPA) | anytime in quiet hours | yes, opt-in + 10DLC | **adapter present** (Africa's Talking; STOP + quiet hours enforced) |
| [X (Twitter)](./channels/x-twitter.md) | user DM / follow rules | per API tier | paid API v2 tiers | **to build** |

## Handoff (seamless)
Two kinds — both in [`handoff.md`](./handoff.md):
- **Cross-channel:** one customer identity (phone/email/handle graph) + the
  cross-channel timeline (`/api/timeline`) means context follows the person from,
  e.g., Instagram to WhatsApp without repeating themselves.
- **AI ↔ human:** `escalate_to_human` flips the conversation to staff takeover
  (`POST /api/whatsapp/reply`), respecting each channel's messaging window.

## Agent-to-agent (A2A)
`POST /api/a2a` + a discovery card at `/.well-known/agent-card.json` let external
agents drive our CRM in natural language, and let ours call peers. See
[`a2a.md`](./a2a.md).

## Compliance & data protection (bounded)
Every send is gated by consent, windows and per-channel policy; PII is minimized,
retained per policy, and erasable. Framework + per-channel duties in
[`compliance.md`](./compliance.md). **Never** send outside a channel's rules.

## Key files
- `src/lib/agent.ts` (agent + tools), `src/lib/inbound.ts` (`processInbound`).
- `src/lib/channels/` — adapters (`parseInbound`, `send`, `verifyWebhook`).
- `src/api/{whatsapp,telegram,channels,omni,a2a}.ts` — HTTP surface.
- `whatsapp-bridge/index.mjs` — Baileys (WhatsApp) + Telegram bridge.

## Endpoints
- `POST /api/chat` — **public** web-chat (`{venue, sessionId, name, text}`), 20/min.
- `POST /api/whatsapp/bridge/inbound` — **service** (bridge → app).
- `GET/POST /api/whatsapp/webhook`, `POST /api/telegram/webhook`,
  `/api/{telegram,instagram,sms}/{webhook,inbound}` — **public** provider webhooks.
- `POST /api/a2a` + `/.well-known/agent-card.json`.
- Staff: `POST /api/whatsapp/reply` (**gated**), `GET /api/whatsapp/conversations`.
- `POST /api/share` (**gated**) — merchant-initiated outbound: push a payment link,
  invoice, QR, booking or enquiry to a customer over WhatsApp / Telegram / SMS
  (`{channel, to, text, link, kind}`). Normalises phones, honours `isSuppressed`,
  logs to `conversations`/`messages`, returns `{delivery}`. Surfaced in-app via the
  `OmniShare` sheet (with a deep-link "open in my own app" fallback).

## Conventions
- **All inbound webhooks are public** — never add `requireAuth`; staff reply/config
  endpoints ARE gated (see auth-tenancy skill).
- Everything flows through `processInbound`; capabilities are agent tools.
- Staff intent `request_payment` ("request payment / pay link / payment link
  [amount] [phone]") mints an ad-hoc pay-link via `createPayLink` and sends it to
  the customer on WhatsApp, falling back to returning the link for manual sharing.
- Pay links can be invoice links or generic `/pay?r=<token>` ad-hoc links for
  Tap&Go, deposits, split-pay or one-off requests; share them via `/api/share` /
  `OmniShare` over WhatsApp, Telegram or SMS.
- Channel config in `app_settings` (`whatsapp_cloud`, `telegram`, …).
- Always 200 the provider fast; never block the webhook on slow work.

## Adding a channel (the pattern)
1. Implement an adapter in `src/lib/channels/<channel>.ts`
   (`parseInbound`, `send`, `verifyWebhook`, opt-in/consent checks).
2. Register it in `getAdapter` and wire its webhook in `src/api/channels.ts`.
3. Store credentials/config in `app_settings`.
4. Add consent + window enforcement per that channel's `channels/*.md`.
5. Add an E2E flow (channel → inbox) and update this matrix.

## Guidelines
- Replies short + mobile-first; pay links on their own line.
- Respect each channel's window/opt-in **before** composing an outbound send.
- Escalate to a human when unsure or when the customer asks.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
