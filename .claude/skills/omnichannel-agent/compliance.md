# Compliance & data protection

The agent is **bounded** — every outbound must clear consent, the channel window,
and per-channel policy **before** it is composed. When in doubt, don't send.

## Consent ledger (opt-in)
- Record opt-in per **identity × channel × category** (marketing / utility /
  transactional), with **timestamp + source** (web, QR, in-store, reply, checkout).
- Consent is **withdrawable** at any time; withdrawal is immediate and global for
  that identity+channel.
- Marketing always needs explicit opt-in; transactional/utility follows the channel
  rule (e.g. WhatsApp utility templates, SMS TCPA consent).

## Messaging-window enforcement (per channel)
| Channel | Free-form window | Outside the window |
| --- | --- | --- |
| WhatsApp | 24h from last user msg | approved template (marketing/utility/auth) |
| Instagram | 24h automated | Human-Agent-Tag 7d **manual only** / limited tags |
| Telegram | none (after `/start`) | anytime, no spam |
| SMS | anytime in **quiet hours** (~8–21 local) | defer |
| Email | anytime with consent | suppression list applies |
| TikTok | inbound-only, per BSP | cannot cold-DM; region-restricted |
| X | per API tier + eligibility | cannot cold-DM |

## Opt-out (must always win)
- Honor **STOP/UNSUBSCRIBE** (SMS), **unsubscribe** (email one-click), **block**
  (Telegram/WhatsApp/IG), and any "stop messaging me".
- Maintain a **global suppression list** per identity+channel that overrides every
  send path (agent, campaigns, reminders). Send a confirmation where required (SMS).

## PII & data protection
- **Minimize:** store only what a conversation needs (identity handle, message,
  order/booking refs). Encrypt at rest; TLS in transit.
- **Retention:** define + enforce a retention window; support **access + erasure**
  (GDPR/CCPA "right to be forgotten") across `conversations`, `messages`, `events`,
  `contacts`.
- **Processors:** Meta (WhatsApp/IG), Telegram, the ESP (email), the SMS aggregator,
  X, and the TikTok BSP are sub-processors — keep **DPAs** and disclose them.
- **Data residency:** know where each processor stores data; reflect in the privacy
  notice.

## Regulations map
- **GDPR / UK-GDPR / CCPA-CPRA** — consent, access, erasure, transparency.
- **TCPA + CTIA + 10DLC/TCR** — SMS/voice consent, STOP/HELP, quiet hours,
  brand/campaign registration.
- **CAN-SPAM** — email opt-out, physical address, honest headers.
- **Meta WhatsApp/Instagram Business & Messaging Policies** — templates, tags, the
  promo-on-tags ban, opt-in.
- **PCI-DSS** — **never** collect card numbers in a chat/DM/SMS/email; send a
  **pay link** to the hosted checkout instead (see payments skill).
- **X Developer Agreement**, **TikTok Commerce/Community + BSP terms**.

## Auditability
Log the **legal basis** for every outbound — the window, the opt-in record, or the
message tag — so any send can be justified. Keep an audit trail on `events`.

## Do / Don't
- ✅ Check consent + window + suppression before composing a send.
- ✅ Prefer utility/transactional; put pay links to hosted checkout.
- ✅ Get consent before switching a customer's channel.
- ❌ No cold outreach where the channel forbids it (TikTok/X/IG/Telegram).
- ❌ No card data in messages. ❌ No promos under Meta message tags. ❌ No sends
  outside quiet hours or to opted-out identities.
