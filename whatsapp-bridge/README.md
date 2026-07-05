# PesaSwap WhatsApp Bridge (Baileys)

Optional sidecar that links a **WhatsApp Business App number by QR code** (the
AgenticCRM model) and forwards messages into the PesaSwap agent pipeline. The
session is persisted in PostgreSQL, so it survives restarts, with keepalive,
auto-reconnect and a stale watchdog for 24/7 operation.

> ⚠️ Baileys uses the **unofficial** WhatsApp Web protocol. It is against
> WhatsApp's Terms of Service and carries a ban risk on the linked number. For
> production, prefer the official **Cloud API** (configured in the dashboard).

## How it works

1. On first start (no saved session) it emits a **QR code**, shown in the
   dashboard at **Settings → WhatsApp**.
2. Scan it from your business phone: WhatsApp → *Linked Devices* → *Link a
   device*.
3. Inbound messages are POSTed to the app (`APP_INBOUND_URL`), which runs the
   same agent (bookings, FAQ/KB, invoices, escalation) and replies **through the
   bridge** — so the bot operates as your own number.

## Env

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://pesaswap:pesaswap@postgres:5432/pesaswap` | Session + key store |
| `APP_INBOUND_URL` | `http://merchant-app:8080/api/whatsapp/bridge/inbound` | Where inbound messages are delivered |
| `BRIDGE_PORT` | `8090` | HTTP control API |
| `BRIDGE_VENUE` | `main` | Venue the linked line belongs to |

## HTTP API

- `GET /status` — connection status + linked number
- `GET /qr` — current pairing QR (data URL) when awaiting scan
- `POST /send` — `{ to, text }` send a message
- `POST /logout` — unlink the device and clear the session
