# PesaSwap FX Engine — Product & Engineering Specification

> **Version:** 3.0 | **Updated:** 2026-05-31
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

### C. Customer Table Ordering (Single-Screen Experience)

> Route: `/table/{tableNumber}` — e.g., `/table/5`
> Mobile-first, bottom nav: 🍽️ Menu | 🛒 Cart | 📋 Bill | 💳 Pay

| #   | Feature                    | Nav Tab  | What It Does                                                        |
| --- | -------------------------- | -------- | ------------------------------------------------------------------- |
| C1  | **QR → Instant Menu**      | Menu     | Scan QR at table → see zone-appropriate menu in <2 seconds          |
| C2  | **Category Browsing**      | Menu     | Horizontal scrollable chips, items as photo cards with dietary tags |
| C3  | **Item Modifiers**         | Menu     | Bottom-sheet overlay for size/extras with live price recalculation  |
| C4  | **Add to Cart**            | Menu     | One-tap quick-add with cart badge count update                      |
| C5  | **Cart Management**        | Cart     | Adjust quantities, special instructions per item, remove items      |
| C6  | **Live Cart Total**        | Cart     | Running total with currency conversion visible                      |
| C7  | **Place Order**            | Cart     | Submit to kitchen/bar with destination routing per item             |
| C8  | **Order More**             | Bill     | Add items to existing bill mid-meal (return to Menu tab)            |
| C9  | **Bill Review**            | Bill     | Full itemized bill with timestamps and order status                 |
| C10 | **One-Screen Payment**     | Pay      | Split + Tip + M-Pesa phone all visible on ONE screen (no 3 steps)   |
| C11 | **Bill Splitting**         | Pay      | Equal split, by-item, custom amounts                                |
| C12 | **Tip Staff by Name**      | Pay      | Shows server name, "tip goes directly to {name}'s M-Pesa"           |
| C13 | **M-Pesa Payment**         | Pay      | STK push to customer's phone, confirm with PIN                      |
| C14 | **Post-Payment Review**    | Success  | 5-star rating + quick tags (Food/Service/Speed/Atmosphere/Value)    |
| C15 | **Receipt & Share**        | Success  | Digital receipt, share via WhatsApp/copy link                       |
| C16 | **Pre-Order Mode**         | Menu     | `/table/5?preorder=true` — browse menu, pick arrival date/time      |
| C17 | **Cart Persistence**       | (auto)   | Cart saved per-table in localStorage, survives page refresh         |
| C18 | **Multi-Language**         | (header) | EN/SW/FR/AR with auto-detect from phone language                    |
| C19 | **Zone-Filtered Menu**     | (auto)   | Table number → zone → only relevant menu shows                      |
| C20 | **Schedule-Filtered Menu** | (auto)   | Time of day → only current menu categories visible                  |
| C21 | **Upsell Suggestions**     | Cart     | "Goes well with..." recommendations based on cart contents          |
| C22 | **External Menu Viewer**   | Menu     | PDF/URL menus embedded (wine list, specials)                        |
| C23 | **Availability Awareness** | Menu     | Sold-out items shown grayed (can't order)                           |

**Customer Flow (end to end):**

```
Scan QR at Table 5
       ↓
/table/5 loads → Zone detected → Menu filtered
       ↓
Browse menu → Add items (modifiers) → Cart builds
       ↓
Review cart → Place order → Kitchen/Bar receives ticket
       ↓
Order confirmed → Bill shows items → Can order more
       ↓
Ready to pay → ONE screen: Split + Tip (to named server) + Phone
       ↓
M-Pesa STK push → Confirm on phone → Done in 3 seconds
       ↓
⭐⭐⭐⭐⭐ Rate experience → Quick tags → Submit review
       ↓
Receipt → Share via WhatsApp → Done
```

**Pre-Order Flow:**

```
Customer browses /table/5?preorder=true (before arriving)
       ↓
Menu visible → Add items → Pick date/time
       ↓
Cart saved to localStorage as pre-order
       ↓
Customer arrives → Scans actual QR at table
       ↓
Pre-order items auto-populate cart → Confirm → Kitchen receives
```

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
| E3  | **Staff**     | Staff management (5 tabs: Team/Performance/Shifts/Payouts/AI)                                                                                             |
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

### F2. Staff App (M-Pesa Enabled — inspired by Sunday for Staff)

> Route: `/dashboard/staff` — 5 tabs: Team | Performance | Shifts | Payouts | Notifications & AI
> Designed for African markets: M-Pesa number = bank account, PIN-based auth, KES throughout

#### Tab 1: Team Management

| #    | Feature                | What It Does                                                                   |
| ---- | ---------------------- | ------------------------------------------------------------------------------ |
| F2.1 | **Staff Directory**    | All staff with photo/initials, name, role badge, phone, active/inactive status |
| F2.2 | **Add Staff Member**   | Name, M-Pesa phone (254XXXXXXXXX), role, PIN, zone assignment                  |
| F2.3 | **Role-Based Access**  | 6 roles: waiter, bartender, kitchen, host, manager, admin                      |
| F2.4 | **Zone Assignment**    | Assign staff to specific zones/table ranges                                    |
| F2.5 | **PIN Authentication** | 4-digit PIN for staff app access (no email/password needed)                    |
| F2.6 | **Quick Actions**      | Edit, deactivate, view profile, send payout — per staff member                 |
| F2.7 | **Today's Stats**      | Each card shows: current shift, tables served today, tips earned               |

#### Tab 2: Performance & Gamification

| #     | Feature                    | What It Does                                                                          |
| ----- | -------------------------- | ------------------------------------------------------------------------------------- |
| F2.8  | **Leaderboard**            | Ranked by: tips, tables served, avg rating, speed, tip percentage                     |
| F2.9  | **Performance Challenges** | Time-bound campaigns with KES rewards (e.g., "50 tables this week = KES 2,000")       |
| F2.10 | **Achievement Badges**     | Top Tipper 🏆, Fastest Service ⚡, Most Tables 🔥, Best Rating ⭐, Upsell Champion 💎 |
| F2.11 | **Period Filtering**       | View stats for today / this week / this month                                         |
| F2.12 | **Challenge Creation**     | Managers create challenges: choose metric, target, reward, duration                   |
| F2.13 | **Progress Tracking**      | Live progress bars per participant toward challenge goals                             |

#### Tab 3: Shift Scheduling

| #     | Feature                    | What It Does                                                |
| ----- | -------------------------- | ----------------------------------------------------------- |
| F2.14 | **Weekly Calendar**        | Mon-Sun grid with staff on Y-axis, shifts as colored blocks |
| F2.15 | **Shift Creation**         | Set date, start/end time, break duration, assign to staff   |
| F2.16 | **Clock In/Out**           | Staff clock in via app; late detection alerts manager       |
| F2.17 | **Today's Roster**         | Quick view: who's currently on shift, who's coming next     |
| F2.18 | **Break Management**       | Track break duration, alert if exceeded                     |
| F2.19 | **Absence Tracking**       | Mark no-shows, trigger notifications to available staff     |
| F2.20 | **AI Staffing Suggestion** | "Based on last month, you need 3 servers on Friday 7-9pm"   |

#### Tab 4: M-Pesa Payouts

| #     | Feature                    | What It Does                                                            |
| ----- | -------------------------- | ----------------------------------------------------------------------- |
| F2.21 | **M-Pesa as Bank Account** | Staff phone number IS their payout destination — no separate bank setup |
| F2.22 | **Individual Payout**      | Send specific amount to one staff member via M-Pesa STK push            |
| F2.23 | **Batch Payout**           | One-click: send all pending tips to all staff simultaneously            |
| F2.24 | **Auto-Payout Settings**   | Configure: daily (end of shift), weekly (Sunday), or manual             |
| F2.25 | **Payout History**         | Full ledger: amount, type (tip/salary/bonus/incentive), status, date    |
| F2.26 | **Payout Summary Cards**   | Total disbursed this period, pending amount, breakdown by type          |
| F2.27 | **Payment Types**          | Tips, salary advances, challenge bonuses, incentive rewards             |
| F2.28 | **Failed Payout Recovery** | Auto-retry failed M-Pesa transactions, alert on persistent failure      |

#### Tab 5: Notifications & AI

| #     | Feature                  | What It Does                                                             |
| ----- | ------------------------ | ------------------------------------------------------------------------ |
| F2.29 | **Real-Time Feed**       | Live notifications: order ready, payment received, tip received, walkout |
| F2.30 | **Walkout Reporting**    | Report walkout: table number, estimated amount, time, description        |
| F2.31 | **AI Performance Coach** | "Amina's turn time increased 40% — consider checking in"                 |
| F2.32 | **AI Scheduling**        | "Friday 7-9pm consistently understaffed by 1 server"                     |
| F2.33 | **AI Training Pairs**    | "James has highest upsell rate — pair with new staff"                    |
| F2.34 | **AI Revenue Insights**  | "Tip pool would increase 23% if all achieve 4.5+ rating"                 |
| F2.35 | **Notification Prefs**   | Per staff: toggle order alerts, payment alerts, schedule changes         |

**Staff Payout Flow (M-Pesa):**

```
Tips accumulate per staff member (from customer payments)
       ↓
Manager reviews → Batch Payout or Individual Payout
       ↓
System sends M-Pesa STK push to 254XXXXXXXXX
       ↓
Staff confirms on phone → KES arrives instantly
       ↓
Payout logged: amount, reference, timestamp, type
```

**Staff Performance Challenge Flow:**

```
Manager creates challenge:
  "Serve 50+ tables this week → earn KES 2,000 bonus"
       ↓
Challenge appears in all eligible staff's Performance tab
       ↓
Progress bars update in real-time as tables are served
       ↓
Challenge completes → Winners get bonus added to pending payout
       ↓
Next batch payout includes bonus → M-Pesa → Staff phone
```

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

| Journey      | Steps                                                                       | Time   | Delight Moment                                |
| ------------ | --------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| First visit  | Scan QR → Browse menu (in Swahili!) → Add items → Order → Pay via M-Pesa    | 90 sec | "No app download, menu in my language"        |
| Return visit | Scan QR → Cart remembered → One-tap pay (saved M-Pesa) → Done               | 10 sec | "It remembered my last order and my phone"    |
| Group dinner | Scan → Order → Split by item → Each person pays their share → Rate & review | 2 min  | "No awkward 'who owes what' conversation"     |
| Pre-order    | Browse menu at home → Add items → Pick arrival time → Arrive → Order ready  | 5 min  | "Food starts cooking when I walk in the door" |
| Tip & review | Pay screen → See server name → Tap 10% → ⭐⭐⭐⭐⭐ → "Great service!"      | 15 sec | "My tip goes straight to Grace's M-Pesa"      |

### Persona 3: Waiter/Staff (David)

**Goal:** Serve tables efficiently, earn good tips directly to M-Pesa, track performance.

| Journey          | Steps                                                          | Time   | Delight Moment                                      |
| ---------------- | -------------------------------------------------------------- | ------ | --------------------------------------------------- |
| Start shift      | Enter PIN → Clock in → See assigned tables/zone                | 5 sec  | "I know my zone and what's expected today"          |
| Take order       | Customer ordered via QR → Kitchen ticket auto-created          | 0 sec  | "I didn't have to write anything down"              |
| Check status     | Glance at notifications → See which orders are ready           | 3 sec  | "I know exactly when to go to the kitchen"          |
| Receive tip      | Customer tips at payment → notification: "KES 150 tip from T5" | 0 sec  | "I see my tip the moment they pay"                  |
| End shift        | Clock out → See day's earnings → Tips auto-sent to M-Pesa      | 10 sec | "Money is already on my phone"                      |
| Challenge        | "Serve 50 tables this week = KES 2,000 bonus" → Track progress | —      | "Gamification makes work fun + extra income"        |
| Handle complaint | Tap refund → Enter reason → AI shows precedent → Approve       | 10 sec | "The system told me 'similar cases got 50% refund'" |

### Persona 4: Kitchen Manager (Grace)

**Goal:** Prepare food efficiently, no surprises, no waste.

| Journey    | Steps                                                     | Time  | Delight Moment                         |
| ---------- | --------------------------------------------------------- | ----- | -------------------------------------- |
| Rush prep  | AI: "Predicted 40% more orders in 30min (Friday pattern)" | —     | "I staffed up before the rush hit"     |
| Sold out   | Tap 86 on item → All active orders notified               | 2 sec | "No one orders something I can't make" |
| End of day | Check AI insights → See consumption rates → Plan tomorrow | 1 min | "I know exactly what to prep"          |

---

## What Makes This 10x Better (Not 10% Better)

| Competitor Approach                 | PesaSwap Approach                                     | Why 10x                            |
| ----------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| Separate POS + payment + menu apps  | **One unified system**                                | No integration hell, no data silos |
| Customer downloads app to pay       | **QR → web (zero install)**                           | 100% adoption on day one           |
| Static menu on paper/PDF            | **Smart menu (zones, schedules, language, sold-out)** | Menu adapts to context             |
| Manual refund process               | **AI-assisted with precedent search**                 | Consistent, fast, fair             |
| Payments logged as flat records     | **Temporal + decision traces**                        | Full "why" not just "what"         |
| Same experience for everyone        | **Context-aware (time, customer, zone, device)**      | Feels personalized                 |
| Monthly reports                     | **Real-time intelligence**                            | Act now, not next month            |
| One payment method                  | **Smart routing (M-Pesa/card/saved) in <100ms**       | Always fastest path                |
| Staff tips via bank transfer (days) | **Tips to M-Pesa instantly**                          | Money on phone same day            |
| Paper staff schedules               | **AI-powered shift scheduling**                       | Right staff, right time, always    |
| Staff performance = guesswork       | **Gamified challenges with real KES rewards**         | Motivated team, measurable results |
| 3-step payment (split→tip→pay)      | **One-screen payment (all visible at once)**          | 3x faster checkout                 |
| No pre-ordering                     | **Pre-order before arriving**                         | Kitchen ready when you walk in     |

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
# /table/5       — Customer table ordering (Table 5, single-screen UX)
# /table/5?preorder=true — Pre-order mode
# /table         — Table entry landing (manual number or QR scan)
# /pay           — QR tap-to-pay
# /merchant      — Mobile merchant app
# /dashboard     — Desktop management (7 pages)
# /dashboard/staff — Staff app (5 tabs: Team/Performance/Shifts/Payouts/AI)
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
│   ├── table.tsx              # Table entry landing page
│   ├── table.$tableId.tsx     # Customer ordering (single-screen, ~2,300 lines)
│   ├── merchant.tsx           # Merchant app shell
│   ├── reports.tsx            # Reports/analytics
│   ├── dashboard.tsx          # Dashboard layout (sidebar)
│   └── dashboard/
│       ├── index.tsx          # Overview (KPIs, charts, live tables)
│       ├── payments.tsx       # Payment management
│       ├── staff.tsx          # Staff app (5 tabs, ~2,800 lines)
│       ├── analytics.tsx      # Deep analytics
│       ├── menu.tsx           # Menu management (2,900 lines)
│       ├── reviews.tsx        # Customer reviews
│       └── settings.tsx       # Configuration
├── components/merchant/
│   ├── MerchantApp.tsx        # Mobile app shell (1,268 lines)
│   ├── MerchantFlows.tsx      # QR invoicing, settlement, PWA
│   └── features/
│       ├── types.ts           # All domain types (~350 lines)
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
│   ├── merchant-dashboard.ts  # Dashboard + staff data layer (~1,500 lines)
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
