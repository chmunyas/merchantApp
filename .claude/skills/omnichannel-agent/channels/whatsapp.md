# WhatsApp

## How it works
Two transports, one adapter (`src/lib/channels/whatsapp*`, `src/api/whatsapp.ts`,
config in `app_settings.whatsapp_cloud`, `transport: auto|cloud|bridge`):
- **Cloud API** (Meta Graph API) — the official path. A verified WhatsApp Business
  Account (WABA) + phone number ID; inbound arrives at `/api/whatsapp/webhook`
  (verify handshake on GET, messages on POST); outbound via
  `graph.facebook.com/<phoneId>/messages`. End-to-end encrypted transport.
- **Baileys bridge** (`whatsapp-bridge/`) — links an existing WhatsApp Business
  **App** number by QR (multi-device). Inbound → `/api/whatsapp/bridge/inbound`;
  outbound via `POST http://localhost:8090/send`. Unofficial: use only where the
  merchant owns the number and accepts WhatsApp's ToS risk.

## Capabilities
Text, media (image/video/doc/audio), interactive **buttons** and **list
messages**, location, reactions, link previews, typing/read receipts. Sessions are
per phone number.

## Initiation & the 24-hour window
- A user message opens a **24-hour customer-service window**: reply with
  **free-form** messages (any content) until it closes.
- Outside the window you may only re-engage with **pre-approved templates** in one
  of three categories — **marketing**, **utility** (transactional: order/booking/
  payment updates), **authentication** (OTP). Templates are Meta-reviewed and
  category-priced.
- Our billing/reminders should send **utility** templates; promos are **marketing**
  and need explicit opt-in + easy opt-out.

## Opt-in & rate/quality
- **Explicit opt-in** is required per category; capture it (web/app/QR/in-store) and
  log it. Provide opt-out.
- Messaging **tiers** cap unique users/day (1K → 10K → 100K → unlimited) and scale
  with your **quality rating**; low quality throttles/flags the number.

## Compliance & data protection
- WhatsApp **Business & Commerce Policies** (no prohibited goods; healthcare/
  financial restrictions apply).
- PII = phone numbers + message content; processed by Meta — reflect this in the
  privacy notice and DPA. Honor opt-out and erasure. GDPR/consent applies.
- Never send OTP/marketing without the right template category + consent.

## Handoff notes
Within the 24h window a human can take over freely (`POST /api/whatsapp/reply`);
outside it, staff must use a template to reopen. See `../handoff.md`.

## Status in this app
**Live** — Cloud API webhook + Baileys bridge both implemented; `transport` chooses
per venue.
