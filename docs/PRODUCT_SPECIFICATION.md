# PesaSwap FX Engine — Product & Engineering Specification

> **Version:** 2.0 | **Updated:** 2026-05-31
> **Philosophy:** Zero-to-One (Thiel) | Apple Simplicity | Japanese Quality (Monozukuri)

---

## The One-Line USP

**"The payment system that gets smarter with every transaction — one QR scan, zero friction, compounding intelligence."**

PesaSwap is not another payment gateway. It is the only platform where payments, restaurant operations, and AI intelligence are a single unified experience — not three products bolted together.

---

## First Principles

### Why This Exists (The Thiel Question)

> "What important truth do few people agree with you on?"

**Our truth:** Restaurant payments in Africa are broken not because of technology, but because every existing solution requires the customer to adapt to the system. We flip it: the system adapts to the customer.

- M-Pesa users get STK push (zero UI — just confirm on phone)
- Returning customers get one-tap (no re-entering details)
- New customers get a full widget (familiar checkout experience)
- The system decides which flow in <100ms based on context

### The 0→1 Moment

No one else combines:

1. **Multi-currency FX engine** (compare providers, best rate routing)
2. **Restaurant-native operations** (menus, zones, scheduling, kitchen routing)
3. **AI that learns from every decision** (not static rules)
4. **Works offline** (PWA with queue-and-sync)

This isn't "payments + restaurant software." It's a new category: **Operational Intelligence for Hospitality.**

### Scale Principles (1→N)

| Principle                     | Implementation                               |
| ----------------------------- | -------------------------------------------- |
| **No app download**           | QR → web. Works on any phone with a browser. |
| **No merchant hardware**      | Any tablet/phone becomes the POS.            |
| **No training needed**        | Apple-level UX: if you can tap, you can pay. |
| **Works at 1 table or 1,000** | Same system, same code, auto-scales on edge. |
| **Every interaction = data**  | System compounds in value (not resets).      |

### Quality Standard (Monozukuri — 物づくり)

The Japanese manufacturing philosophy: obsessive attention to craft at every level.

- **Zero-defect payments:** Idempotency keys prevent double charges. Always.
- **Graceful degradation:** If WebSocket fails → polling. If network drops → offline queue.
- **Edge cases are first-class:** What happens when kitchen is understaffed AND item sells out AND customer already ordered? The system handles it.
- **Temporal integrity:** Every fact has provenance. Every decision is traceable. No "we don't know what happened."

---

## Platform Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CUSTOMER TOUCHPOINTS                       │
│  /pay (QR tap)  │  /table (dine-in)  │  /converter (FX)    │
└────────┬────────────────┬──────────────────────┬────────────┘
         │                │                      │
┌────────▼────────────────▼──────────────────────▼────────────┐
│                    MERCHANT TOOLS                             │
│  /merchant (mobile)  │  /dashboard (desktop)                │
│  POS · Invoicing · Tables · AI Insights · Wallets           │
└────────┬────────────────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────────────────┐
│                    INTELLIGENCE LAYER                         │
│  Payment Agent · Menu Agent · Service Agent · Fraud Agent   │
└────────┬────────────────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE                             │
│  Cloudflare Workers · PesaSwap SDK · WebSocket/Polling      │
│  D1 (temporal) · R2 (media) · KV (cache) · Vectorize (AI)  │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Inventory

### A. FX Engine (Core Platform)

| #   | Feature                    | Route             | What It Does                                                  | USP Angle                       |
| --- | -------------------------- | ----------------- | ------------------------------------------------------------- | ------------------------------- |
| A1  | **Multi-Currency Wallet**  | `/`               | View balances across KES, USD, GBP, EUR. Real-time rates.     | One view, all currencies        |
| A2  | **FX Converter**           | `/converter`      | Convert between currencies with live rate comparison          | Best rate, always               |
| A3  | **Provider Comparison**    | `/` + `/merchant` | Compare Wise, Currencycloud, LMAX, Verto side-by-side         | Transparency (no hidden markup) |
| A4  | **Smart Settlement**       | `/merchant`       | Routes payout through cheapest/fastest provider automatically | AI picks best route             |
| A5  | **Beneficiary Management** | `/beneficiaries`  | Save and manage payout recipients                             | Send money in 2 taps            |
| A6  | **Transaction Ledger**     | `/payments`       | Full history with filters, export, reconciliation             | Complete audit trail            |
| A7  | **Wallet Reconciliation**  | `/merchant` (tab) | Match incoming/outgoing, flag discrepancies                   | Japanese precision              |

### B. Payment Flows

| #   | Feature                   | Trigger                | Flow                                                 | Time to Complete |
| --- | ------------------------- | ---------------------- | ---------------------------------------------------- | ---------------- |
| B1  | **M-Pesa STK Push**       | KES + phone number     | Server sends push → customer confirms on phone       | 3 seconds        |
| B2  | **One-Tap Saved Method**  | Returning customer     | Show saved method → one tap to confirm               | 1 second         |
| B3  | **Full Checkout Widget**  | New customer / card    | Load PesaSwap widget → enter details → pay           | 15 seconds       |
| B4  | **QR Tap & Pay**          | `/pay`                 | Scan QR → auto-detect amount → confirm → done        | 5 seconds        |
| B5  | **Table Split Payment**   | `/table`               | Choose split mode (equal/by-item/custom) → pay share | 10 seconds       |
| B6  | **Invoice Payment**       | Link/QR from merchant  | Open link → see amount → pay via preferred method    | 8 seconds        |
| B7  | **Refund (Full/Partial)** | Dashboard/merchant app | Select transaction → refund amount → confirm         | 3 seconds        |
| B8  | **Offline Queue**         | No network             | Queue payment → auto-submit when reconnected         | Transparent      |

**Payment Decision Logic (the intelligence):**

```
IF returning_customer AND has_saved_method → One-Tap (1s)
ELSE IF currency=KES AND amount<150K AND has_phone → M-Pesa STK (3s)
ELSE → Full Checkout Widget (15s)
```

### C. Restaurant Operations (Table Service)

| #   | Feature                    | Location | What It Does                                                 |
| --- | -------------------------- | -------- | ------------------------------------------------------------ |
| C1  | **QR Table Ordering**      | `/table` | Customer scans QR at table → sees menu → orders → pays       |
| C2  | **Menu Browsing**          | `/table` | Category tabs, photos, descriptions, dietary tags, modifiers |
| C3  | **Item Modifiers**         | `/table` | Size/extras selection with live price calculation            |
| C4  | **Bill Splitting**         | `/table` | Equal split, by-item, custom amounts                         |
| C5  | **Tipping**                | `/table` | Percentage or custom tip with staff attribution              |
| C6  | **Order More**             | `/table` | Add items to existing bill mid-meal                          |
| C7  | **Multi-Language**         | `/table` | EN/SW/FR/AR with auto-detect from phone language             |
| C8  | **Upsell Suggestions**     | `/table` | "Goes well with..." after adding item to cart                |
| C9  | **External Menu Viewer**   | `/table` | PDF/URL menus embedded (wine list, specials)                 |
| C10 | **Receipt & Share**        | `/table` | Digital receipt with full breakdown, share via phone         |
| C11 | **Availability Awareness** | `/table` | Sold-out items shown grayed (can't order)                    |
| C12 | **Zone-Filtered Menu**     | `/table` | Table number → zone → only relevant menu shows               |
| C13 | **Schedule-Filtered Menu** | `/table` | Time of day → only current menu categories visible           |

### D. Menu Management (Dashboard)

| #   | Feature                 | Tab       | What It Does                                      |
| --- | ----------------------- | --------- | ------------------------------------------------- |
| D1  | **Catalogue CRUD**      | Items     | Add/edit/delete menu items with all fields        |
| D2  | **Product Photos**      | Items     | Upload images (base64), thumbnails in grid/list   |
| D3  | **Descriptions**        | Items     | Rich text descriptions shown to customers         |
| D4  | **Dietary Tags**        | Items     | Vegan, vegetarian, gluten-free, halal, etc.       |
| D5  | **Item Modifiers**      | Items     | Size/extras groups with price adjustments         |
| D6  | **Availability Toggle** | Items     | One-tap 86/sold-out without deleting              |
| D7  | **Destination Routing** | Items     | Kitchen vs bar per item                           |
| D8  | **Linked Products**     | Items     | "Suggested pairings" for upselling (max 3)        |
| D9  | **Multi-Language**      | Items     | Translations dialog (EN/SW/FR/AR) per item        |
| D10 | **CSV Import**          | Items     | Upload CSV → field mapping → preview → import     |
| D11 | **CSV Export**          | Items     | One-click download of full catalogue              |
| D12 | **Category Reorder**    | Items     | Drag-and-drop category display priority           |
| D13 | **Bulk Actions**        | Items     | Multi-select → change category/destination/delete |
| D14 | **Search & Filter**     | Items     | Real-time search + category filter                |
| D15 | **Grid/List Toggle**    | Items     | View preference for catalogue                     |
| D16 | **Multiple Menus**      | Menus     | Create named menus with category selections       |
| D17 | **Menu Activation**     | Menus     | Toggle active/inactive per menu                   |
| D18 | **Zone Configuration**  | Zones     | Define areas with table ranges + assigned menus   |
| D19 | **Menu Scheduling**     | Schedules | Time-based visibility (lunch, dinner, happy hour) |
| D20 | **External Menus**      | External  | Upload PDF or paste URL (wine list, specials)     |
| D21 | **Menu Preview**        | (button)  | Phone-frame modal showing exact customer view     |

### E. Dashboard (Desktop Management)

| #   | Page          | Key Capabilities                                                                                                                                          |
| --- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | **Overview**  | Revenue today, transaction count, avg ticket, active tables, 7-day trend chart, QR adoption rate, payment method mix, live table map, recent transactions |
| E2  | **Payments**  | Full transaction ledger, filters (status/date/method), refund actions                                                                                     |
| E3  | **Staff**     | Staff list, performance metrics, shift management, tip attribution                                                                                        |
| E4  | **Analytics** | Revenue trends, peak hours, category performance, customer segments                                                                                       |
| E5  | **Menu**      | Full menu management (21 features above)                                                                                                                  |
| E6  | **Reviews**   | Customer review aggregation, sentiment, response management                                                                                               |
| E7  | **Settings**  | Business info, payment config, notification preferences, integrations                                                                                     |

### F. Merchant Mobile App

| #   | Tab               | What It Does                                         | Key Interaction       |
| --- | ----------------- | ---------------------------------------------------- | --------------------- |
| F1  | **Home**          | Quick stats, recent activity, notifications          | At-a-glance health    |
| F2  | **Tap & Go POS**  | Accept payments via QR/NFC/manual entry              | Tap → paid            |
| F3  | **Table Service** | Manage tables, orders, kitchen tickets, reservations | Full floor management |
| F4  | **Invoicing**     | Create, send, track invoices with installment plans  | Send → get paid       |
| F5  | **Invoice List**  | Segmented ledger (All/Paid/Pending/Overdue)          | Filter → act          |
| F6  | **AI Insights**   | Revenue predictions, anomaly alerts, recommendations | Glance → decide       |
| F7  | **Wallets**       | Multi-currency balances, reconciliation              | Verify → settle       |
| F8  | **Scan**          | QR scanner for payments and table identification     | Point → done          |

### G. Intelligence & Real-Time

| #   | Feature                      | How It Works                                                          |
| --- | ---------------------------- | --------------------------------------------------------------------- |
| G1  | **Real-Time Notifications**  | WebSocket (primary) + polling (fallback). Audio alerts by category.   |
| G2  | **Payment Status Streaming** | Live status updates: pending → processing → succeeded/failed          |
| G3  | **Smart Payment Routing**    | Agent selects optimal method in <100ms based on 6 context signals     |
| G4  | **AI Scoring**               | Revenue prediction, demand forecasting, anomaly detection             |
| G5  | **Idempotency**              | Every payment has unique key; duplicate requests return cached result |
| G6  | **Exponential Backoff**      | WebSocket reconnection: 1s → 2s → 4s → 8s (max 10 attempts)           |
| G7  | **Offline PWA**              | Service worker caches app; payments queue and sync when online        |

### H. Infrastructure & DevOps

| #   | Component          | Implementation                                                              |
| --- | ------------------ | --------------------------------------------------------------------------- |
| H1  | **Edge Compute**   | Cloudflare Workers (global, <10ms cold start)                               |
| H2  | **Build**          | Vite 7 + TanStack Start (SSR + client hydration)                            |
| H3  | **CI/CD**          | GitHub Actions: lint → typecheck → test → build → deploy                    |
| H4  | **Testing**        | Vitest (72 unit tests), lint-staged pre-commit hooks                        |
| H5  | **Security**       | Env validation (fail-fast), no hardcoded secrets, HMAC webhook verification |
| H6  | **Error Handling** | Route-level ErrorBoundary with recovery UI                                  |
| H7  | **Type Safety**    | Full TypeScript, strict mode, 0 type errors                                 |
| H8  | **Code Quality**   | ESLint 9 flat config, Prettier, Husky pre-commit                            |

---

## API Reference

| Method | Endpoint                                | Purpose                                     |
| ------ | --------------------------------------- | ------------------------------------------- |
| POST   | `/api/payments/create`                  | Create payment (amount, currency, metadata) |
| GET    | `/api/payments/:id/status`              | Poll payment status                         |
| POST   | `/api/refunds`                          | Issue full/partial refund                   |
| GET    | `/api/customers/payment-methods?phone=` | Get saved methods for one-tap               |
| POST   | `/api/webhooks/pesaswap`                | Receive payment status callbacks            |
| GET    | `/api/notifications?merchant=&since=`   | Poll notifications (fallback)               |
| WS     | `/api/realtime?merchant=`               | WebSocket for live updates                  |

---

## Environment Configuration

```bash
# Required (client)
VITE_PESASWAP_PUBLISHABLE_KEY=pk_...    # Loads checkout widget

# Required (server)
PESASWAP_API_KEY=prd_...                 # Server-to-server API calls
PESASWAP_URL=https://app.Pesaswap.io     # API base URL

# Optional
VITE_BACKEND_URL=                        # Custom backend (defaults to same origin)
PESASWAP_WEBHOOK_SECRET=                 # HMAC verification for callbacks
```

---

## User Personas & Journeys

### Persona 1: Restaurant Owner (Amina)

**Goal:** Increase revenue, reduce operational chaos, understand her business.

| Journey     | Steps                                                           | Time   | Delight Moment                                  |
| ----------- | --------------------------------------------------------------- | ------ | ----------------------------------------------- |
| Setup       | Create account → Upload menu (CSV) → Set zones → Print QR codes | 15 min | "My entire menu is digital in 15 minutes"       |
| Daily       | Check dashboard overview → See live tables → Review AI insights | 30 sec | "Revenue up 18% this month — AI showed me why"  |
| Menu change | Toggle sold-out → Drag category to top → Preview → Done         | 5 sec  | "Customers never order something we don't have" |

### Persona 2: Customer (James)

**Goal:** Order food, pay fast, get back to his conversation.

| Journey      | Steps                                                            | Time   | Delight Moment                            |
| ------------ | ---------------------------------------------------------------- | ------ | ----------------------------------------- |
| First visit  | Scan QR → Browse menu (in Swahili!) → Add items → Pay via M-Pesa | 45 sec | "No app download, menu in my language"    |
| Return visit | Scan QR → One-tap pay (saved M-Pesa) → Done                      | 5 sec  | "It remembered me. One tap."              |
| Group dinner | Scan → Order → Split by item → Each person pays their share      | 2 min  | "No awkward 'who owes what' conversation" |

### Persona 3: Waiter (David)

**Goal:** Serve tables efficiently, earn good tips, avoid mistakes.

| Journey          | Steps                                                    | Time   | Delight Moment                                      |
| ---------------- | -------------------------------------------------------- | ------ | --------------------------------------------------- |
| Take order       | Customer ordered via QR → Kitchen ticket auto-created    | 0 sec  | "I didn't have to write anything down"              |
| Check status     | Glance at app → See which orders are ready               | 3 sec  | "I know exactly when to go to the kitchen"          |
| Handle complaint | Tap refund → Enter reason → AI shows precedent → Approve | 10 sec | "The system told me 'similar cases got 50% refund'" |

### Persona 4: Kitchen Manager (Grace)

**Goal:** Prepare food efficiently, no surprises, no waste.

| Journey    | Steps                                                     | Time  | Delight Moment                         |
| ---------- | --------------------------------------------------------- | ----- | -------------------------------------- |
| Rush prep  | AI: "Predicted 40% more orders in 30min (Friday pattern)" | —     | "I staffed up before the rush hit"     |
| Sold out   | Tap 86 on item → All active orders notified               | 2 sec | "No one orders something I can't make" |
| End of day | Check AI insights → See consumption rates → Plan tomorrow | 1 min | "I know exactly what to prep"          |

---

## What Makes This 10x Better (Not 10% Better)

| Competitor Approach                | PesaSwap Approach                                     | Why 10x                            |
| ---------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| Separate POS + payment + menu apps | **One unified system**                                | No integration hell, no data silos |
| Customer downloads app to pay      | **QR → web (zero install)**                           | 100% adoption on day one           |
| Static menu on paper/PDF           | **Smart menu (zones, schedules, language, sold-out)** | Menu adapts to context             |
| Manual refund process              | **AI-assisted with precedent search**                 | Consistent, fast, fair             |
| Payments logged as flat records    | **Temporal + decision traces**                        | Full "why" not just "what"         |
| Same experience for everyone       | **Context-aware (time, customer, zone, device)**      | Feels personalized                 |
| Monthly reports                    | **Real-time intelligence**                            | Act now, not next month            |
| One payment method                 | **Smart routing (M-Pesa/card/saved) in <100ms**       | Always fastest path                |

---

## Quality Gates (Monozukuri Standard)

Every feature must pass before shipping:

| Gate                   | Standard                                          | Verification                   |
| ---------------------- | ------------------------------------------------- | ------------------------------ |
| **Type Safety**        | Zero TypeScript errors                            | `npm run typecheck` (0 errors) |
| **Test Coverage**      | All business logic tested                         | `npm test` (72+ tests passing) |
| **Lint Clean**         | Zero warnings on touched code                     | ESLint + Prettier pre-commit   |
| **Build Clean**        | Production build succeeds                         | `npm run build` (<2s)          |
| **Offline Resilient**  | Core flows work without network                   | PWA service worker             |
| **Edge Case Handled**  | Empty states, errors, timeouts all graceful       | Manual + automated             |
| **Idempotent**         | No operation can produce duplicate side effects   | Idempotency keys               |
| **Temporal Integrity** | Every mutation has timestamp + actor + provenance | Middleware enforcement         |
| **Sub-3s First Paint** | Page loads in <3s on 3G connection                | Lighthouse CI                  |
| **Accessible**         | Keyboard navigable, contrast ratios met           | WCAG 2.1 AA                    |

---

## Developer Quick Start

```bash
git clone https://github.com/chmunyas/merchantApp.git
cd merchantApp
cp .env.example .env          # Add your PesaSwap keys
npm install
npm run dev                   # → http://localhost:5173

# Key routes to explore:
# /              — FX wallet & converter
# /table?t=5    — Customer table ordering (demo)
# /pay          — QR tap-to-pay
# /merchant     — Mobile merchant app
# /dashboard    — Desktop management (7 pages)
```

---

## File Architecture (for developers)

```
src/
├── routes/
│   ├── index.tsx              # FX wallet/converter home
│   ├── converter.tsx          # Currency conversion
│   ├── beneficiaries.tsx      # Payout recipients
│   ├── payments.tsx           # Transaction ledger
│   ├── pay.tsx                # QR tap-to-pay flow
│   ├── table.tsx              # Customer table ordering (2,450 lines)
│   ├── merchant.tsx           # Merchant app shell
│   ├── reports.tsx            # Reports/analytics
│   ├── dashboard.tsx          # Dashboard layout (sidebar)
│   └── dashboard/
│       ├── index.tsx          # Overview (KPIs, charts, live tables)
│       ├── payments.tsx       # Payment management
│       ├── staff.tsx          # Staff performance
│       ├── analytics.tsx      # Deep analytics
│       ├── menu.tsx           # Menu management (2,900 lines)
│       ├── reviews.tsx        # Customer reviews
│       └── settings.tsx       # Configuration
├── components/merchant/
│   ├── MerchantApp.tsx        # Mobile app shell (1,268 lines)
│   ├── MerchantFlows.tsx      # QR invoicing, settlement, PWA
│   └── features/
│       ├── types.ts           # All domain types (252 lines)
│       ├── hooks.ts           # Shared React hooks
│       ├── utils.ts           # Formatting, calculations
│       ├── TapGoPOS.tsx       # Point-of-sale terminal
│       ├── TableServiceView.tsx    # Full table service
│       ├── InvoiceCreator.tsx      # Invoice form
│       ├── AIInsightsView.tsx      # AI intelligence
│       └── WalletReconciliationView.tsx  # Wallet ops
├── lib/
│   ├── pesaswap-payments.ts   # Payment SDK abstraction (17.5KB)
│   ├── realtime.ts            # WebSocket + polling (10KB)
│   ├── use-payment.ts         # Payment state machine hook
│   ├── merchant-dashboard.ts  # Dashboard data layer (1,132 lines)
│   └── env-validation.ts      # Environment validation
├── api/
│   └── payments.ts            # Server API routes (18.4KB)
├── hooks/
│   └── use-mobile.ts          # Responsive hook
└── components/
    ├── ErrorBoundary.tsx      # Route error boundary
    └── ui/                    # Shadcn/Radix primitives
```

---

## Roadmap: What's Next

### Near-Term (Weeks 1-4)

- [ ] Replace localStorage → Cloudflare D1 (persistent, multi-device)
- [ ] Add authentication (Clerk) with multi-tenant isolation
- [ ] Payment state → Cloudflare KV (survives cold starts)
- [ ] Image upload → R2 (not base64 in localStorage)
- [ ] Deploy to production Cloudflare Workers

### Medium-Term (Weeks 5-8)

- [ ] Decision trace middleware (capture WHY for every action)
- [ ] Bitemporal fact storage (know what was true WHEN)
- [ ] AI Payment Agent v1 (routes based on customer graph)
- [ ] Precedent search (find similar past decisions)
- [ ] Push notifications (order ready, payment received)

### Long-Term (Months 3-6)

- [ ] SurrealDB graph store (entity relationships at scale)
- [ ] Menu Intelligence Agent (demand prediction, auto-pricing)
- [ ] Multi-merchant marketplace
- [ ] Native iOS/Android app (from PWA → native)
- [ ] POS hardware integration (receipt printers, card readers)

---

## Success Metrics

| Metric                         | Target      | Why It Matters                            |
| ------------------------------ | ----------- | ----------------------------------------- |
| Time to first payment          | <45 seconds | Adoption depends on instant value         |
| Payment success rate           | >98%        | Every failure = lost revenue              |
| Customer return rate (one-tap) | >60%        | Proves the "remembers you" promise        |
| Average order value lift       | +15-25%     | Upselling via linked products + modifiers |
| Menu update to live            | <5 seconds  | Operational agility                       |
| Dispute resolution time        | <30 seconds | Bitemporal queries prove facts instantly  |
| System uptime                  | 99.95%      | Edge compute + graceful degradation       |

---

_Built with obsessive attention to craft. Every pixel, every millisecond, every edge case._

_PesaSwap — Where payments become intelligence._
