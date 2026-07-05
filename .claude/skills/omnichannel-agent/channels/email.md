# Email

## How it works
Send via an **ESP** (SendGrid, Postmark, Amazon SES, Resend, …) over authenticated
SMTP/API; receive replies via the ESP's **inbound-parse webhook** (a dedicated
`reply+<conversationId>@…` address maps a reply back to the conversation). Two
message classes: **transactional** (receipts, invoices, booking confirmations) and
**marketing** (campaigns).

## Capabilities
Rich HTML + plaintext multipart, attachments, inline images, per-recipient
personalization, threading via `Message-ID` / `In-Reply-To` / `References`, and
open/click tracking. Great for invoices/receipts (attach a PDF, embed the pay link).

## Authentication & deliverability (mandatory in 2025)
Google & Yahoo **bulk-sender** rules (senders >5k/day, but apply them always):
- **SPF + DKIM + DMARC** all valid (DMARC at least `p=none`; prefer `quarantine`/
  `reject`). **TLS** on send.
- **One-click unsubscribe** via the `List-Unsubscribe` + `List-Unsubscribe-Post`
  headers (RFC 8058) **and** a body link.
- Keep the **spam-complaint rate < 0.3%**; warm dedicated IPs; monitor DMARC/
  feedback loops. RFC 5322/5321 compliant messages.

## Opt-in & legal compliance
- **Marketing** requires **opt-in** (GDPR: explicit, logged, withdrawable).
- **CAN-SPAM** (US): truthful headers/subject, a valid **physical postal address**
  in the footer, clear opt-out honored **within 10 business days**.
- Transactional mail doesn't need marketing opt-in but must not carry promos.

## Compliance & data protection
PII = email address + content; store minimally, encrypt at rest, honor erasure and
suppression lists (a global unsubscribe/suppression list is mandatory). Never email
a suppressed/opted-out address.

## Handoff notes
Email is async and window-free — ideal for delayed human follow-up and for sending
invoices/receipts that started on a chat channel. Keep the `conversationId` in the
reply address so replies re-enter `processInbound`.

## Status in this app
**To build.** Add `src/lib/channels/email.ts` (ESP send + inbound-parse webhook →
`processInbound` with `channel:"email"`), a suppression list, and the auth records
above. Reuse the invoicing skill's pay link.
