# SMS

## How it works
Send/receive via an aggregator (Twilio, Africa's Talking, Infobip, …). Inbound
arrives at the provider webhook (`/api/sms/webhook` / `/inbound` via
`src/lib/channels/sms*`); outbound via the provider's send API. Number types: **A2P
10DLC** (US long codes), **toll-free** (US, needs verification), **short codes**,
and country-specific alphanumeric/sender IDs elsewhere.

## Capabilities & cost
Plain text (segmented at 160 GSM-7 / 70 UCS-2 chars — keep it short; each segment
bills). **MMS** for media where supported. No typing/read receipts. High
reach/immediacy; premium cost.

## Registration (US A2P 10DLC — required)
Register a **Brand** and each **Campaign** with **The Campaign Registry (TCR)** via
the provider before sending; unregistered traffic is filtered/blocked. Throughput
+ trust score depend on the campaign vetting.

## Opt-in / opt-out (TCPA — strict)
- **Prior express consent** before the first message; log when/where/how; disclose
  frequency + "msg & data rates may apply".
- Honor **STOP / UNSUBSCRIBE / CANCEL / END / QUIT** → **immediately** stop +
  send one confirmation. **HELP** → reply with brand name, purpose, support
  contact, and how to opt out.
- **Quiet hours:** send only ~**8am–9pm local** (stricter in some states, e.g. FL
  8am–8pm); defer outside the window.

## Compliance & data protection
TCPA + CTIA messaging principles + carrier rules; GDPR/consent for non-US.
PII = phone number + content; minimize, secure, and maintain a per-number opt-out
suppression list that overrides everything.

## Handoff notes
SMS has no session window but is consent- and quiet-hours-bound; use it for
time-critical confirmations/OTP and reminders. For richer flows, invite the
customer to WhatsApp. See `../handoff.md`.

## Status in this app
Adapter present (channel `sms`). Wire a provider + webhook, implement STOP/HELP +
quiet-hours + suppression before any outbound campaign.
