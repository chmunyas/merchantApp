# X (Twitter)

## How it works
Direct Messages via the **X API v2** (`/2/dm_conversations`, `/2/dm_events`).
Requires a paid developer tier and app auth (OAuth 2.0 user context). Inbound:
poll `dm_events`, or use **Account Activity**/webhooks on higher tiers. Outbound:
`POST /2/dm_conversations/.../messages`.

## Access tiers (paid — plan accordingly)
- **Free** — effectively write-only, tiny monthly caps; not viable for DM bots.
- **Basic** (~$100/mo) — small volume; hobby/small business.
- **Pro / Enterprise** — real throughput + Account Activity webhooks + higher rate
  limits (Enterprise is contract-based).
Lower tiers cap DM endpoints around ~15 requests/15 min — **throttle and back off**.
Rate limits change often; read `developer.x.com` before shipping.

## Capabilities & eligibility
1:1 (and group) DMs, text + media + quick-reply-style buttons. **Eligibility rules
apply:** you generally can't DM users who don't follow you or who disallow DMs from
non-followers, so X is **reactive** (they DM you / you're mutuals) — not for cold
outreach.

## Opt-in & compliance
- Bound by the **X Developer Agreement & Policy** and **automation rules**: no bulk
  unsolicited DMs, no spam, respect rate limits (violations → suspension/key
  revocation).
- PII = X handle/user id + content; minimize + honor erasure. GDPR/consent applies
  for any marketing use.

## Handoff notes
Given eligibility limits and cost, use X for reactive support and to move the
customer to WhatsApp/email/SMS for transactions. See `../handoff.md`.

## Status in this app
**To build.** Add `src/lib/channels/x.ts` (v2 DM send + inbound poll/webhook →
`processInbound` with `channel:"x"`), store the app tokens in `app_settings`, and
budget for a **Basic+** API tier. Enforce eligibility + rate-limit back-off in
`send`.
