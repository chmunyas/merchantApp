# Instagram (Direct)

## How it works
Instagram Messaging via Meta's **Messenger Platform / Instagram Graph API**.
Requires an Instagram **Business/Creator** account linked to a Facebook Page and
the `instagram_manage_messages` permission. Inbound (DMs, story replies/mentions,
comment-triggered "private replies") arrives at the Meta webhook
(`/api/instagram/webhook` via `src/lib/channels/instagram*`); outbound via the
Graph API `/<IG_ID>/messages`.

## Capabilities
Text, media, quick replies, **ice breakers** (tappable starter questions shown on
first open), persistent menu, story-reply context, and **private replies** to
comments/mentions (one per comment). No group DMs.

## Initiation & windows (strict)
- **No cold DM.** The user must message first (DM, story reply, or mention).
- **24-hour standard window:** free-form (automated or manual) replies for 24h from
  the user's last message.
- **Human-Agent-Tag → 7 days:** a *manual* human agent may reply up to 7 days after
  the last user message — **automation is not allowed** under this tag.
- **Message tags:** limited non-promotional reasons to message outside 24h
  (e.g. account/post-purchase updates). **Never** use tags for promotions — misuse
  risks account restriction. (Meta is tightening/deprecating some tags; verify
  current list before relying on one.)

## Opt-in & rate limits
Consent is implicit when the user initiates; still honor opt-out. Rate limits per
Meta Graph (per-app/per-user); back off on `#613` throttling.

## Compliance & data protection
- Meta Platform + Messaging policies; the promotional-content ban on tags is
  enforced.
- PII = IG handle + message content, processed by Meta (DPA + privacy notice).
  GDPR consent/erasure applies; keep an audit of window/tag basis for each send.

## Handoff notes
When the agent can't resolve within 24h, escalate to a **human** (their 7-day
Human-Agent window is manual-only) — do not auto-message under the tag. Cross-
channel: if you also have the customer's WhatsApp/phone, continue there. See
`../handoff.md`.

## Status in this app
Adapter present (channel `instagram`); wire the Meta webhook + page token to go
live. Enforce the 24h/7-day/tag rules in the adapter's `send`.
