# Handoff (seamless)

Two kinds of handoff — both must preserve context and respect each channel's rules.

## 1. Cross-channel (person follows, context follows)
- **One identity.** `processInbound` identity-resolves each inbound to a single
  person via an **identity graph** (phone / email / handle → contact). The same
  customer on Instagram and WhatsApp is one contact, one history.
- **Cross-channel timeline.** `GET /api/timeline?phone=` returns every message
  to/from a person across WhatsApp, web, Telegram, IG, SMS (and, once built, TikTok/
  Email/X) so the agent (or a human) never asks them to repeat themselves.
- **"Continue on WhatsApp" pattern.** On inbound-only/limited channels (TikTok, X,
  Instagram), capture a reachable identifier early and continue on an initiable
  channel — but only after **consent to switch** (log it).
- **State carries.** The agent loads the contact's open enquiries/invoices/bookings,
  so a booking started on web can be paid via a WhatsApp pay link.

## 2. AI ↔ human (escalation & takeover)
- The agent calls **`escalate_to_human`** when unsure, on explicit request, or for
  sensitive/complex cases → the conversation is flagged for staff.
- **Warm handoff:** hand the human a short summary + the timeline; don't restart.
- **Takeover:** staff reply via `POST /api/whatsapp/reply` (**gated**), which sends
  on the conversation's own channel adapter. AI pauses until released.
- **Window-aware:** the send must satisfy the channel window —
  - WhatsApp: free-form only inside 24h, else a template.
  - Instagram: 24h automated; **7-day human-agent** window is **manual only**.
  - Telegram: no window (after `/start`).
  - SMS: any time within **quiet hours**, consent required.
  - Email/web: async, no window.
  See each `channels/*.md`.

## 3. Agent ↔ agent
Handoff to/from external agents goes through A2A — see `a2a.md`.

## Guidelines
- Never lose context on handoff; never make the customer repeat themselves.
- Get + log consent before moving someone to a new channel.
- Respect the destination channel's window/opt-in **before** the first message.
- Return control to the AI cleanly after a human resolves the issue.
