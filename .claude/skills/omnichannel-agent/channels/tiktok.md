# TikTok

> **Reality check:** TikTok has **no open cold-outreach DM API**. Business
> messaging is **inbound-first** and available **only through TikTok Business
> Solution Providers (BSPs)** (e.g. Infobip, SleekFlow, respond.io, MessageGate,
> UIB) — and is **region-restricted** (generally *not* available to business
> accounts based in the US, UK and the EEA). Treat TikTok as reactive support +
> commerce, not broadcast.

## How it works
- **TikTok Business Messaging** (via a BSP): respond to users who DM your business
  account, and trigger automations on inbound DMs (and sometimes post comments).
  The BSP exposes webhooks (delivered/read events) and a send API.
- **TikTok Shop** APIs (separate): order/fulfilment/returns/finance events for
  post-sale messaging — the richest, most stable TikTok integration for commerce.
- **Direct-Message Ads:** click-to-message ads open a chat; campaign source +
  keywords flow back for optimization.

## Capabilities & limits
- **1:1 conversations only**, initiated by the **user** — you cannot cold-DM.
- Text is universal; **image/media support is region-limited** (restricted in the
  US and some markets); links are sent as **plain text** only.
- Automations trigger on new inbound DMs; analytics via the BSP inbox.

## Opt-in & compliance
- Consent is the inbound message itself; still honor stop/opt-out.
- Bound by **TikTok's Commerce/Community policies** + the **BSP's** terms; keep to
  the BSP's approved templates/flows. Verify **regional availability** for the
  merchant's account country before promising this channel.
- PII = TikTok handle + message content, processed by TikTok + the BSP (DPA);
  GDPR/erasure applies.

## Handoff notes
Because TikTok is inbound-only and region-limited, **capture contact details early**
(phone/email/WhatsApp) and continue the relationship on a channel you can initiate.
See `../handoff.md`.

## Status in this app
**To build.** Implement `src/lib/channels/tiktok.ts` against a chosen BSP's
webhook + send API, register it in `getAdapter`, store BSP creds in `app_settings`,
and gate sends on inbound-window + region rules. Prefer TikTok Shop APIs for
order/commerce messaging.
