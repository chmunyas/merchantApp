# PesaSwap Merchant — Setup & User Guide

A step-by-step guide to setting up your business on PesaSwap: create your account,
add your stores, build your menu, take payments (Tap & Go, QR, pay links,
invoices), accept pre-orders, and use every service capability. Every step below
is live and verified end-to-end.

> **In a hurry?** The 5-minute path: **Sign up → add a few menu items with prices
> → create a QR code → print it → take your first Tap & Go payment.** Everything
> else can be added later.

---

## 1. Create your account (self-serve, no keys needed)

1. Go to **`/get-started`**.
2. Enter your **business name**, **email**, a **password** (8+ characters), and an
   optional **phone**.
3. Tap **Create account**. You're taken straight to your **dashboard** (`/dashboard`).

That's it — your account and your **first store (venue)** are created together, fully
isolated from every other merchant. The dashboard header shows **your** business
name from the start.

- **Bank / partner link?** If you were sent a link like `/get-started?org=<bank>`,
  you'll see that partner's co-brand and your store is linked to them automatically.
- **Logging back in:** use **`/login`** with your email + password.

---

## 2. Set up your business profile

Open **Dashboard → Settings** (`/dashboard/settings`).

- **Business name, phone, address** — shown on receipts, QR stickers and the pay page.
- **M-Pesa Till / Paybill number** — this is what customers pay into. **Set this
  before taking live payments** (Tap & Go and KE-QR encode it).
- **Logo & brand colour** — appear on your dashboard, QR stickers and the customer
  pay page.
- **Payment methods** — toggle M-Pesa, Card, Apple/Google Pay.

---

## 3. Build your menu (items & prices)

Open **Dashboard → Menu** (`/dashboard/menu`).

1. Tap **Add item**.
2. Enter the **name**, **category** (e.g. Mains, Drinks), **price** (whole KES),
   optional **dietary tags** (vegan, halal…) and **availability**.
3. Save. The item is stored server-side and instantly appears everywhere — the
   customer QR page, the AI agent's answers, and the kitchen.

**Tips**
- Prices are in whole shillings (e.g. `350`).
- Toggle **availability** off to hide a sold-out item without deleting it.
- **Sync to agent** keeps the WhatsApp/Telegram assistant's menu identical.
- Free plan: up to **50 menu items** per store (upgrade for more).

---

## 4. Set up tables / floor plan (for dine-in)

Open **Dashboard → Tables** (`/dashboard/tables`).

- **Add table** — number/label, **seats**, and a **section** (e.g. Patio).
- Build **combinations/zones** for bookings and the floor plan.
- Free plan: up to **20 tables** per store.

Not doing dine-in? You can skip this — collection/counter service works without tables.

---

## 5. Create & print QR codes

Open **Dashboard → QR codes** (`/dashboard/qr`).

1. Choose a **kind**:
   - **Venue / Counter** — one code for the whole shop (customer chooses collection
     or eat-in).
   - **Table** — attach to a specific table (defaults to dine-in at that table).
2. Tap **Create**, then **Print**.

Each printed code shows **two ways to pay** on one sticker:
- **Phone camera** → opens your branded order-and-pay page (`/q/<code>`).
- **KE-QR** → the CBK national QR any bank / M-Pesa app can scan.

---

## 6. Customers order & pre-order (collection or eat-in)

When a customer scans your code they land on **`/q/<code>`** and can:

1. Browse your menu and build a cart.
2. Choose **🍽️ Eat in** or **🛍️ Collection**.
3. Choose **ASAP** or **pre-order for a later time** (pick a date/time).
4. Add their phone (to earn loyalty) and **Pay**.

Their order — with the **fulfilment type** and **pickup/eat-in time** — appears on
your **Kitchen / Orders** screen (`/dashboard/orders`) with a clear **Collection /
Pickup** and **Pre-order · time** badge, so staff prep it for the right moment.

---

## 7. Take payments

You have several ways to get paid — all through PesaSwap:

| Method | Where | Best for |
| --- | --- | --- |
| **Tap & Go** | Merchant app → **Tap & Go** | Face-to-face: type an amount, customer scans the QR or you send an M-Pesa STK prompt |
| **Scan-to-order & pay** | Printed QR → `/q/<code>` | Self-service ordering + payment |
| **Pay link** | Tap & Go / order / invoice → share | Send a payment link over WhatsApp, Telegram or SMS |
| **Invoice** | **Dashboard → Invoices** | Billing a customer with line items + due date (recurring supported) |
| **KE-QR** | Any printed code | A customer paying from their **own** bank / M-Pesa app |

- **Amounts are server-bound** — a pay link/QR resolves the real amount server-side,
  so it can never be tampered with in the URL.
- **Refunds, disputes and a full payment timeline** are on **Dashboard → Payments**.
- **Settlement & reconciliation** (fees, net, payouts) are on **Dashboard → Settlement**.

> **Going live:** enter your **Till/Paybill** in Settings. To switch real money on,
> a PesaSwap `PESASWAP_API_KEY` + `PESASWAP_WEBHOOK_SECRET` must be set on the
> deployment (ask your PesaSwap contact). Until then, payments run in a safe
> simulated mode so you can test the whole flow.

---

## 8. Run more than one store (multi-store)

One login can own several stores.

1. Open the **venue picker** (top-left of the dashboard).
2. Tap **Add a store**, name it, and it's created — empty and isolated, ready to set
   up its own menu/tables/till.
3. **Switch stores** any time from the same picker — the whole dashboard re-scopes to
   the selected store.

You can only switch into stores **you** own, and nothing (menu, orders, payments,
customers) ever leaks between stores. Free plan: up to **2 stores**.

---

## 9. All the other services

| Capability | Where | What it does |
| --- | --- | --- |
| **Bookings & enquiries** | Dashboard → Enquiries / Bookings; public `/enquire` | Take table reservations + customer questions |
| **AI assistant (omnichannel)** | Web chat + WhatsApp / Telegram | Answers FAQs, shows the menu, books tables, sends pay links — same agent on every channel |
| **CRM & loyalty** | Dashboard → Contacts | Customers, tiers (Bronze→Platinum), points, a rewards portal |
| **Campaigns & automations** | Dashboard → Campaigns | Segmented broadcasts + drip sequences (STOP/opt-out + quiet hours enforced) |
| **Staff & tips** | Dashboard → Staff | Staff PIN login, roles, tip attribution + pooling |
| **Inventory** | Dashboard → Inventory | Stock, low-stock alerts, reorder (retail) |
| **Analytics & accounting** | Dashboard → Analytics / Accounting | Sales, best-sellers, a double-entry general ledger |
| **Reviews & reputation** | Dashboard → Reviews | Ratings, replies, guest sentiment |

---

## 10. Go-live checklist

- [ ] Business **name, phone, address** set (Settings)
- [ ] **M-Pesa Till/Paybill** set (Settings) — required for real payments
- [ ] **Logo + brand colour** uploaded
- [ ] **Menu** items + prices added (and synced to the agent)
- [ ] **Tables** added (if you do dine-in)
- [ ] **QR codes** created + printed for counter/tables
- [ ] Took a **test Tap & Go** payment and a **test scan-to-order**
- [ ] (PesaSwap) live payment keys set on the deployment
- [ ] (Optional) WhatsApp / Telegram connected for the AI assistant

---

## Quick reference — key screens

| Screen | URL |
| --- | --- |
| Get started (signup) | `/get-started` |
| Log in | `/login` |
| Dashboard home | `/dashboard` |
| Settings (profile, till, branding) | `/dashboard/settings` |
| Menu editor | `/dashboard/menu` |
| Tables / floor plan | `/dashboard/tables` |
| QR codes | `/dashboard/qr` |
| Kitchen / Orders | `/dashboard/orders` |
| Payments (refunds, disputes) | `/dashboard/payments` |
| Invoices | `/dashboard/invoices` |
| Settlement | `/dashboard/settlement` |
| Customer order page | `/q/<code>` |
| Customer pay page | `/pay` |

Need help? The in-dashboard **Copilot** (`/dashboard/copilot`) can answer questions
about your own data and run tasks for you.
