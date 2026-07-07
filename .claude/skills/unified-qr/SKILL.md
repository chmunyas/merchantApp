---
name: unified-qr
description: >-
  Multi-code unification — one QR that runs the whole counter journey: browse the
  menu, build an order, pay (M-Pesa STK / QR), auto-enroll loyalty and open a
  receipt portal. Use for tasks about scan-to-order, table/venue QR codes, the
  /q/:code page, or "one code = order + pay + enroll + receipt".
---

# Unified QR (multi-code unification)

One printed code replaces the till queue: a customer scans, a branded page opens,
they order, pay on their own phone (M-Pesa STK / QR), earn loyalty and keep a
receipt portal. Every scan is a data point (time, venue, amount) — the QR is a
data-collection point, not just a payment tool. This is the Alipay/WeChat "one
code" insight localized to M-Pesa.

## Key files
- `src/api/qr.ts` — resolve/create codes, log scans, build an order + pay URL.
- `src/routes/q.$code.tsx` — the public, branded, mobile-first unified page.
- `src/routes/dashboard/qr.tsx` — generate + print codes.
- `db/23-qr.sql` — `qr_codes`, `qr_scans`.

## Endpoints
- `GET /api/qr` / `POST /api/qr` — list / create codes (authed, venue-scoped).
- `GET /api/qr/:code` — **public**; resolve → { venue, branding, table?, items };
  logs a `qr_scans` row.
- `POST /api/qr/:code/order` — **public**; creates an order, returns
  { orderId, amount, payUrl } where payUrl is a server-bound token link.
- `GET /api/qr/pay/:token` — **public**; server-authoritative order payinfo
  (amount, merchant) for a single-use, 15-minute token — the pay page reads the
  amount from here, never from the URL.

## Conventions
- Reuse the existing pay flow (`/pay?…`) — never rebuild payments here.
- Loyalty enrolls through the pay flow (points on success by `customer_phone`).
- Amounts are minor units, KES; authed routes scope by venue.
- **The order pay link is a server-bound token** (`/pay?o=<token>`) — single-use,
  15-minute expiry, amount bound to the server order (never trusted from the URL).
- The printed code carries only an opaque id; resolve server-side.

## Guidelines
- Keep the public page dependency-light and resilient (works on a cheap phone).
- Log every scan — that behavioural data is the product.
- Prefer per-table codes so a scan knows the seat; a venue code still works.

## KE-QR (CBK national standard) — conformance status

> **Status: NOT conformant — by design.** Every QR the app emits today is a
> **URL to our own web checkout** (closed-loop, phone-camera → our page → PesaSwap
> STK). Kenya's national **KE-QR** standard (CBK, 2023; based on **EMVCo
> Merchant-Presented Mode v1.1**) is an **open-loop EMVCo TLV data object** meant
> to be parsed and routed by *any* licensed bank/DFSP app. These are different
> paradigms — our QR is invisible to the interoperable QR rail, and no KE-QR data
> objects are currently produced. Documented here so the gap is explicit; **no
> KE-QR generator has been built.**

**What our QR encodes today (all URL or proprietary JSON — never EMVCo TLV):**
- `dashboard/qr.tsx` → `https://…/q/{codeId}` (unified code).
- `dashboard/invoices.tsx` → invoice `pay_link` URL.
- `features/TapGoPOS.tsx` → `/pay?tapgo=<base64>` (proprietary JSON fallback).
- `features/TableServiceView.tsx`, `routes/pay.tsx` → web checkout / portal URL.
- `MerchantApp.tsx` / `MerchantFlows.tsx` → pay URL / `{type:"fx-engine/invoice"}` JSON.
- `lib/merchant-dashboard.ts` `createTableQrValue` → `{merchant,till,table,route}` JSON.

**Missing mandatory EMVCo/KE-QR data objects (all of them):** `00` Payload Format
Indicator (`"01"`), `01` Point of Initiation (`11` static / `12` dynamic), `28`/`29`
Merchant Account Info with GUID `ke.go.qr`, `52` MCC, `53` Currency (`404`), `54`
Amount, `58` Country (`KE`), `59` Merchant Name, `60` City, `63` **CRC-16/CCITT**
(poly `0x1021`, init `0xFFFF`). No TLV structure (2-digit id + 2-digit len + value),
no CRC integrity check.

**What already aligns (principles, not format):** merchant-presented mode; **no
customer PII in the code**; static-vs-dynamic concept (`/q/:code` static, pay-token
dynamic); amount bound server-side; customer authenticates in their own app (PIN);
DBA merchant name shown.

**Hard dependency (blocks true conformance):** interoperable KE-QR needs a
**CBK-directory merchant identifier issued to a licensed PSP/DFSP** — tied to
**PesaSwap's PSP registration / GUID**, not self-issuable by the app. Without it we
can format a valid TLV but other banks can't route it.

**If/when we implement:** add an EMVCo-TLV generator (with CRC-16) that runs
*alongside* the existing URL QR (additive, non-breaking) — dynamic (amount-bound)
and static variants — gated on obtaining the real PSP/merchant identifier from
PesaSwap. See the CBK KE-QR standard for the full data-object table and the Parts
A–D printed-sticker layout (acceptance logos, DBA name).

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
