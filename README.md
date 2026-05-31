# PesaSwap Merchant App

A full-stack mobile-first payment platform built with React 19 + TanStack Start + Vite 7, deployed on Cloudflare Workers. Integrates [PesaSwap SDK](https://docs.pesaswap.io) for M-Pesa, card, Apple Pay, and Google Pay payments.

## ✨ Features

### Merchant Side
- **Tap & Go POS** — Numpad → QR generation → real-time payment confirmation
- **Table Service** — Table management, QR per table, split payments, tips tracking
- **Order Routing** — Kitchen/bar order queue with live status
- **Catalogue Management** — Items, prices, dietary tags, destinations
- **Invoice Creator** — Multi-currency, partial payments, FX lock, recurring
- **AI Intelligence** — Revenue forecast, smart staffing, anomaly detection, customer insights
- **Loyalty Program** — Auto-enroll, tiered points (Bronze→Platinum)
- **Reservations** — Table booking with capacity management

### Customer Side
- **`/pay`** — Scan QR → one-tap M-Pesa payment (8 seconds vs 2 minutes old way)
- **`/table`** — Scan table QR → view bill → split → tip → pay
- **Order at Table** — Browse menu, place orders routed to kitchen/bar
- **Multi-language** — English, Swahili, French (auto-detected)

### Payments (PesaSwap SDK)
- M-Pesa STK Push (zero-UI for returning customers)
- Card payments via HyperLoader widget
- Apple Pay / Google Pay
- Full refund flow with item-level granularity
- Real-time WebSocket notifications to merchant
- Idempotency protection (no double charges)
- Server-side payment verification

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm 9+

### Setup

```bash
# Clone the repo
git clone https://github.com/chmunyas/merchantApp.git
cd merchantApp

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your PesaSwap keys (get them from https://app.pesaswap.io)

# Start development server
npm run dev
```

App runs at `http://localhost:5173/`

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_PESASWAP_PUBLISHABLE_KEY` | Client-side publishable key (starts with `pk_`) | ✅ |
| `PESASWAP_API_KEY` | Server-side secret key (starts with `prd_` or `snd_`) | ✅ |
| `PESASWAP_URL` | API endpoint (`https://app.Pesaswap.io`) | ✅ |
| `VITE_BACKEND_URL` | Your deployed backend URL (empty for local) | Optional |
| `PESASWAP_WEBHOOK_SECRET` | Webhook signature verification secret | Optional |

---

## 📁 Project Structure

```
src/
├── api/
│   └── payments.ts          # Server API routes (create payment, refund, webhook, status)
├── components/
│   └── merchant/
│       └── MerchantApp.tsx   # Main merchant app (~5000 lines, all merchant logic)
├── lib/
│   ├── pesaswap-payments.ts # Payment service layer (SDK integration)
│   ├── realtime.ts          # WebSocket real-time notifications
│   ├── utils.ts             # Shared utilities
│   ├── error-capture.ts     # Error tracking
│   └── error-page.ts        # Error page renderer
├── routes/
│   ├── __root.tsx           # Root layout (sidebar bypass for /pay, /table)
│   ├── index.tsx            # Home → MerchantApp
│   ├── pay.tsx              # Customer Tap&Go payment page
│   └── table.tsx            # Customer table payment page
├── server.ts                # Cloudflare Worker entry (routes API + SSR)
├── router.tsx               # TanStack Router config
├── routeTree.gen.ts         # Generated route tree
└── styles.css               # Tailwind CSS 4 styles

__tests__/
├── TEST-PLAN.md             # 146-test plan across 16 modules
├── unit/                    # Unit tests (Vitest)
└── e2e/                     # E2E specs (Playwright)

test-utils/
├── seed-data.ts             # Factory functions for test data
└── localStorage-mock.ts     # Mock for Vitest
```

---

## 🔌 Payment Integration Architecture

```
Customer Device          Your Backend (CF Worker)       PesaSwap Engine
─────────────────       ──────────────────────────     ────────────────
/pay or /table    ────→  POST /api/payments/create ──→  POST /payments
                  ←────  { client_secret }          ←──  { payment_id }
                  
HyperLoader SDK   ────→  (direct to PesaSwap)      ──→  Process payment
                  ←────  { status: succeeded }      ←──  Confirm

                         POST /api/webhooks/pesaswap ←── payment.succeeded
                         → Update table, award loyalty
                         → WebSocket → merchant notification (1-3s)
```

### Payment Flows

| Scenario | Flow | Clicks |
|----------|------|--------|
| M-Pesa (KES < 150K) | STK push to phone → confirm on handset | **1 tap** |
| Returning customer | Saved method → auto-confirm | **1 tap** |
| New card customer | Full checkout widget | **3 taps** |

---

## 🧪 Testing

```bash
# Unit tests
npx vitest run

# Type check
npx tsc --noEmit

# Lint
npm run lint
```

See `__tests__/TEST-PLAN.md` for the full 146-test plan covering all personas.

---

## 🏗️ Build & Deploy

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview

# Deploy to Cloudflare Workers
npx wrangler deploy
```

---

## 👥 Developer Personas & Routes

| Persona | Primary View | Key Features |
|---------|-------------|--------------|
| Merchant/Owner | `/` (home) | Dashboard, invoices, AI insights, settings |
| Server/Waiter | Tables tab | Table management, payments, tips |
| Kitchen Staff | Orders Queue | Incoming orders, prep status, completion |
| Bar Staff | Orders Queue (bar) | Drink orders, cocktail queue |
| Host | Reservations | Table assignments, walk-ins, booking |
| Dine-in Customer | `/table?t=<qr>` | View bill, split, tip, order, pay |
| Retail Customer | `/pay?tapgo=<qr>` | Scan QR, confirm, M-Pesa pay |
| Ops Manager | AI tab | Forecasts, staffing, anomalies |

---

## 📝 Key Technical Notes

- **State management**: localStorage-based (keys: `fxengine.merchant.*`)
- **Route bypass**: `/pay` and `/table` render without sidebar
- **QR format**: Base64-encoded JSON in URL param (`?t=<base64>` or `?tapgo=<base64>`)
- **Audio alerts**: Web Audio API (880Hz sine wave) for payment notifications
- **Auto-close**: Tables auto-close when `paidAmount >= total`
- **Multi-language**: Auto-detect from `navigator.language`, manual toggle EN/SW/FR

---

## 🔑 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/payments/create` | Create payment intent |
| GET | `/api/payments/:id/status` | Check payment status |
| POST | `/api/refunds` | Process refund (full or partial) |
| GET | `/api/customers/payment-methods` | Get saved payment methods |
| POST | `/api/webhooks/pesaswap` | Receive payment events |
| GET | `/api/notifications` | Poll notifications (fallback) |
| WS | `/api/realtime` | WebSocket for real-time events |

---

## License

Private — PesaSwap © 2025
