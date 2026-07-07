---
name: customer-experience
description: >-
  The end-to-end CUSTOMER journey — scan a QR at a table or around a venue, browse
  the menu, place an order, split and pay the bill, tip the server, earn and redeem
  loyalty, and get a receipt — as ONE seamless flow. Use for any task about the
  guest/customer experience, scan-to-order, split-pay, in-flow tipping, loyalty
  earn/redeem from the customer side, receipts, or removing friction from the
  customer journey.
---

# Customer experience (the seamless guest journey)

The customer-facing counterpart to the merchant back office. One goal: a guest
scans once and glides through **discover → order → split → pay → tip → earn/redeem
loyalty → receipt** with no re-auth, no app install, and no dead ends. This skill
owns that journey and keeps its steps stitched into a single flow.

The journey (and where each step lives today):

1. **Scan** — table or venue/area QR → `/q/:code` (`src/routes/q.$code.tsx`);
   resolves via `GET /api/qr/:code` (`src/api/qr.ts:188`). QR `kind` distinguishes a
   **table** code (joined to `dining_tables`) from a venue/area code
   (`src/api/qr.ts:66-94, 191-237`).
2. **Order** — build a cart and submit: `POST /api/qr/:code/order`
   (`src/api/qr.ts:97`). **Server-authoritative total** — the amount is recomputed
   server-side from validated items, never trusted from the client.
3. **Pay** — `/pay` (`src/routes/pay.tsx`). Short, server-bound links:
   `/pay?o=<token>` (QR order → `GET /api/qr/pay/:token`, `src/api/qr.ts:152`) and
   `/pay?i=INV-XXX` (invoice → `/api/invoices/payinfo`) and `/pay?r=<token>`
   (pay-link → `/api/pay-links/:token`). Tap&Go, split and booking-deposit flows
   can now be sent as shareable server-bound links, not only scanned. Charge via
   `POST /api/payments/create` (M-Pesa STK today). The unified `usePayment` hook
   (`src/lib/use-payment.ts`) already carries `split` and `tip` metadata.
4. **Split** — self-service split-pay on `/pay`: **Pay all / Split evenly (N) /
   By item / Custom**. Each guest pays a share against the same order **on their
   own phone / M-Pesa STK**; the server tracks the balance and **clamps every
   charge to the remaining balance** (server-authoritative — a guest can never
   overpay). After a share is paid, the success screen shows **"KES X still due —
   next person pays"** and reloads the order so the next diner pushes their own STK;
   the order settles (and its pay token closes) only when cumulative payments cover
   the total. A failed/cancelled STK offers a **seamless one-tap retry** (re-fires
   the same share to the same number — `retryPayment` in `src/routes/pay.tsx`).
   Shares: `src/lib/split-bill.ts`; balance in `GET /api/qr/pay/:token`; clamp +
   settlement in `src/api/payments.ts` (`handleCreatePayment` + `recordLedger`).
5. **Tip** — in-flow "tip your server" on `/pay`: suggestions (None / 5 / 10 / 15% /
   custom) **on top of** the share, attributed to a server the guest picks from the
   venue's tippable staff (returned by `GET /api/qr/pay/:token`). The tip is passed
   as `tip_amount` (minor units) + `staff_id`, persisted by `recordLedger` and
   **excluded from the order balance** (a gratuity never settles the bill). Tips
   feed attribution/pooling/payout (`src/api/tips.ts`, `src/lib/tips.ts`).
6. **Loyalty** — points accrue automatically on a succeeded payment, keyed on
   `metadata.customer_phone` (`src/api/payments.ts:250-268`). Rewards live in
   `loyalty_rewards` (`db/26-loyalty-portal.sql`); redemption is via the portal.
7. **Receipt + rewards portal** — token-based self-service at `/me/:token`
   (`src/routes/me.$token.tsx`): order/invoice/payment history + rewards redeem.
   Token issued by `POST /api/portal/token` → `GET /api/portal/:token` /
   `POST /api/portal/:token/redeem` (`src/api/portal.ts`).

## Key files (customer-facing)
- `src/routes/q.$code.tsx` + `src/api/qr.ts` — scan-to-order (unified QR) + guest
  services (Book a table, Ask us, Request the bill → `/api/enquiries`) + remembered
  phone (localStorage) so returning guests are recognised.
- `src/components/QrScanner.tsx` — live camera QR scanner (BarcodeDetector, graceful
  fallback); camera allowed via `Permissions-Policy: camera=(self)` in `server.ts`.
- `src/routes/pay.tsx` + `src/lib/use-payment.ts` + `src/api/payments.ts` — checkout.
- `src/api/tips.ts` / `src/lib/tips.ts` — tip capture, attribution, pooling, payout.
- `src/api/portal.ts` + `src/routes/me.$token.tsx` — receipts + loyalty portal.
- `src/lib/loyalty.ts` + `db/26-loyalty-portal.sql` — points, tiers, rewards.
- Saved methods (`customer_payment_methods`, `db/37`+`db/38`) — the guest's M-Pesa
  number (remembered on pay) + tokenised cards/wallets (persisted by the PesaSwap
  webhook, brand+last4 only) surface inline on `/q` by **phone**, so a returning
  guest sees "💳 Visa •••4242 saved" without any re-entry.
- `dining_tables` + QR `kind` — table vs venue/area identity.

## Conventions
- **Amounts are always server-authoritative.** The client never sets the price to
  charge; `/pay` resolves it from `?o=`/`?i=`/`?r=` server-side. Never trust a URL
  amount.
- **Frictionless auth:** the customer is identified by **phone** (the loyalty key)
  and reaches history via a **portal token** (`/me/:token`) — no password/app.
- **Loyalty is phone-keyed and automatic** on first success (idempotent; never
  double-counts). Keep `customer_phone` flowing through order → pay → ledger so
  points accrue and the receipt/portal can be handed off.
- **Tips attribute to a `staff_id`** and are pooled/paid via the tips skill — a
  customer tip must carry the serving staff so attribution survives.
- **Public, rate-limited endpoints** (scan/order/pay/portal) are never behind
  `requireAuth`; gating them breaks the guest flow.
- Amounts in the ledger are **minor units**; the QR/order/invoice amounts the guest
  sees are whole KES — convert at the boundary.

## Guidelines (design for seamlessness)
- **One continuous flow, not separate pages.** Prefer scan → order → pay → receipt
  without a manual page/token hop or re-entry of the phone.
- **Carry context forward:** table, server (`staff_id`), phone and order token should
  propagate through every step so split, tip, loyalty and receipt "just work".
- **Degrade gracefully:** a guest with no phone can still order + pay; loyalty is an
  additive bonus, never a blocker.
- **Confirm, don't surprise:** show the resolved amount, split share, tip and points
  earned before charging.

## Current gaps → roadmap (build these to close the seamless loop)
1. **Self-service split-pay (DONE):** guests split a bill on `/pay` (evenly /
   by-item / custom) and each pays their share against one order balance; the
   server clamps every charge to the remaining balance and settles only when the
   total is covered (`src/lib/split-bill.ts`, `src/api/payments.ts`,
   `GET /api/qr/pay/:token`, `src/routes/pay.tsx`).
2. **In-flow "tip your server" (DONE):** `/pay` shows tip suggestions (None /
   5 / 10 / 15% / custom) on top of the share and a serving-staff picker; the tip
   rides on top of the bill (excluded from the order balance) with `tip_amount` +
   `staff_id` (`src/lib/tip.ts`, `src/routes/pay.tsx`, `GET /api/qr/pay/:token`).
3. **Seamless receipt + loyalty handoff (DONE):** on payment success `/pay` shows a
   receipt (bill / tip / amount paid), **points earned this visit + balance + tier**,
   and an auto-issued portal token (QR + link) in one screen — `POST /api/portal/token`
   now returns the loyalty snapshot; points use the shared `loyaltyPointsFor`
   (`src/lib/loyalty.ts`, `src/routes/pay.tsx`).
4. **Auto-enroll loyalty in the QR flow (DONE):** the QR order page looks up a
   returning guest's points + tier inline as they type their phone
   (`GET /api/loyalty/status`) and shows what this order will earn (shared
   `loyaltyPointsFor`); enrolment completes automatically on payment
   (`recordLedger`). `src/routes/q.$code.tsx`, `src/api/portal.ts`.
5. **Customer offers / promo codes (DONE):** guests apply a discount code when they
   order (percentage or fixed, with min-order / usage-cap / expiry); the server
   re-validates + applies it to `orders.total` and increments usage. Merchants manage
   codes at `/dashboard/promos`. `src/lib/promo.ts`, `src/api/promo.ts`,
   `GET /api/promo/validate`, `db/36`.
6. **Unify the journey (DONE):** `/pay` reads its source from typed route search
   params (`validateSearch` + `Route.useSearch`) and the scan flow navigates in-app
   (no full-page reload), so scan → order → pay → tip → loyalty → receipt is one
   continuous SPA journey (`src/routes/q.$code.tsx`, `src/routes/pay.tsx`).

## Related skills
`unified-qr` (scan → order + pay + enrol + receipt), `orders-kitchen`, `payments`,
`tips`, `crm-loyalty`, `customer-portal`, `omnichannel-agent` (chat-driven ordering
+ bill + handoff). This skill is the umbrella that keeps those steps a single guest
journey.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
