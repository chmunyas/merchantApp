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
- `src/lib/ke-qr.ts` — **CBK KE-QR** EMVCo-TLV generator (CRC-16, static/dynamic).
- `src/components/pay/PaymentQr.tsx` — shared KE-QR + camera-URL QR renderer.
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
- Order requests contain only stable menu UUIDs + quantities. The server resolves
  names, availability, currency, and price and snapshots them into the order.
- Resolving the order pay token mints a short-lived single-use payment intent;
  `/api/payments/create` consumes it and ignores client financial metadata.
- Loyalty enrolls through the pay flow (points on success by `customer_phone`).
- Amounts are minor units, KES; authed routes scope by venue.
- **The order pay link is a server-bound token** (`/pay?o=<token>`) — single-use,
  15-minute expiry, amount bound to the server order (never trusted from the URL).
- The printed code carries only an opaque id; resolve server-side.

## Guidelines

- Keep the public page dependency-light and resilient (works on a cheap phone).
- Log every scan — that behavioural data is the product.
- Prefer per-table codes so a scan knows the seat; a venue code still works.

## KE-QR (CBK national standard) — conformant

> **Status: conformant TLV generator shipped.** The app now produces
> **CBK KE-QR** payloads (EMVCo Merchant-Presented Mode v1.1 TLV) on every
> merchant-presented **KES** payment surface, alongside the existing closed-loop
> "scan with your phone camera" URL QR. A payer can now scan the same sticker in
> **any licensed bank / M-Pesa app**, verify merchant name + amount, and authorise
> with their own PIN. **Remaining dependency:** a real CBK-directory PSP/merchant
> identifier (via PesaSwap's PSP registration) — until issued we encode the till
> under the `ke.go.qr` scheme with a placeholder account; interoperable routing by
> other banks activates once the real id is set.

**Core:** `src/lib/ke-qr.ts` — pure, isomorphic TLV builder.

- `buildKeQr(merchant, options)` emits the full payload: `00` Payload Format
  Indicator `"01"`, `01` POI (`11` static / `12` dynamic), `28` Merchant Account
  Info (GUID `ke.go.qr` + till), `52` MCC, `53` Currency `404`, `54` Amount (KES,
  no decimals — minor→whole shillings), `58` Country `KE`, `59` Merchant Name
  (DBA, ≤25), `60` City, `61` Postal, `62` Additional Data (reference/store/bill,
  no PII), `63` **CRC-16/CCITT-FALSE** (poly `0x1021`, init `0xFFFF`).
- `crc16ccitt`, `formatKeQrAmount`, `resolveKeQrMerchant`, `parseKeQr`,
  `validateKeQr` helpers. Unit-tested (`__tests__/unit/ke-qr.test.ts`, 16 tests)
  including the canonical CRC check value `crc16ccitt("123456789") === 0x29B1`.

**Component:** `src/components/pay/PaymentQr.tsx` — renders the KE-QR with a
"Scan in any bank or M-Pesa app" caption (merchant name + amount) and an optional
"Phone camera" toggle for the closed-loop URL. `keqr={false}` on non-KES surfaces
(KE-QR is a KES-only domestic standard).

**Wired surfaces (merchant-presented, KES):**

- `features/TapGoPOS.tsx` — dynamic (amount-bound) KE-QR + camera toggle.
- `features/TableServiceView.tsx` — table sticker, static KE-QR + camera.
- `routes/dashboard/qr.tsx` — printable unified sticker, camera-primary + KE-QR toggle.
- `routes/dashboard/settings.tsx` — per-table asset stickers now encode static KE-QR
  (PNG/PDF export preserved).
- `routes/dashboard/invoices.tsx` + `MerchantApp.tsx` invoice detail — dynamic KE-QR
  **only when `currency === "KES"`**, else the pay URL.

**Out of scope:** the payer-side `/pay` checkout (they authenticate via STK, not by
scanning) and `MerchantFlows.tsx` (an international **FX** demo, non-KES).

**Config:** national defaults (`KE_QR_DEFAULTS`: guid `ke.go.qr`, MCC `5812`, city
`Nairobi`, country `KE`, postal `00`) fill everything except the merchant name +
till, which come from branding/settings. The acquiring **PSP id** (+ optional MCC /
city overrides) is a platform-global setting entered in **Admin → Settings → KE-QR**
(`app_settings('ke_qr')`, `GET/PUT /api/ke-qr-config`, cached client-side by
`src/lib/ke-qr-config.ts` and consumed by `PaymentQr`). Flipping in the real CBK
`pspId` needs **no deploy**. See `BACKLOG.md` (Payments) for the dependency.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: unified-qr -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- One secure venue/table code for accurate browse, order, server-bound split/tip/payment, loyalty enrollment, receipt, self-service, expiration, regeneration, and staff recovery.
- Tamper, replay, enumeration, wrong-table, stale-menu, duplicate-order, partial-payment, offline/resume, accessibility, camera, and cross-device behavior with no amount or tenant authority in the URL.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
