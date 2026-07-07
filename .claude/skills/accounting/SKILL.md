---
name: accounting
description: >-
  Maintain the audit-grade general ledger — accounting, ledger, general ledger,
  double-entry, journal, chart of accounts, trial balance, P&L / income
  statement, balance sheet, AR aging, lost basket, financial statements,
  bookkeeping, and audit.
---

# Accounting & general ledger

Double-entry, audit-grade general ledger for merchant financial statements.
Payments, refunds, settlement batches, invoice issue/settlement, COGS, tip
payouts and manual adjustments post balanced journal entries; reports surface
P&L, balance sheet, trial balance, per-account ledger, AR aging and lost baskets.
Fiscal periods can be closed (locked) once reported.

## Key files
- `src/lib/accounting.ts` — chart (`CHART`), balanced line-builders, `postEntry`
  (rejects posts into a closed period), event wrappers, reports, period close,
  `auditEntries` (oldest-first source for the audit hash chain).
- `src/lib/hash.ts` — `sha256Hex` used to build the audit hash chain.
- `src/api/accounting.ts` — gated `/api/accounting/*` routes.
- `db/30-accounting.sql` — `ledger_accounts`, `journal_entries`, `journal_lines`;
  `db/31-accounting-periods.sql` — `ledger_periods` (close/lock). Minor units.
- `src/api/payments.ts` (`recordLedger`) + `src/api/settlement.ts` — best-effort
  hooks (payment/refund/settlement/COGS; invoice payments settle A/R).
- `src/lib/invoices.ts` + `src/lib/invoicing.ts` — invoice issue posts A/R;
  `recordPayment` settles it. `src/api/tips.ts` — `POST /api/tips/payout`.
- `src/routes/dashboard/accounting.tsx` — accounting dashboard UI.

## Endpoints (all gated)
- `GET /api/accounting/chart` — chart of accounts.
- `GET /api/accounting/trial-balance?from=&to=` — debits/credits; must balance.
- `GET /api/accounting/income-statement?from=&to=` — P&L.
- `GET /api/accounting/balance-sheet?asOf=` — rolls P&L into retained earnings.
- `GET /api/accounting/journal?from=&to=&limit=` — journal entries + lines.
- `GET /api/accounting/ledger/:code?from=&to=` — account ledger + running balance.
- `GET /api/accounting/ar-aging` — invoices as the AR subledger (minor units).
- `GET /api/accounting/lost-basket?from=&to=` — unpaid orders subledger.
- `GET /api/accounting/summary?from=&to=` — dashboard rollup.
- `GET /api/accounting/audit?from=&to=` — **manager+** tamper-evident export:
  each entry carries a `contentHash`; entries are chained
  (`chainHash = SHA-256(prevHash + contentHash)`), and `finalHash` anchors the
  whole period. Reordering/altering/inserting/deleting any entry breaks the chain.
- `POST /api/accounting/journal` — **manager+** manual balanced adjustment.
- `GET /api/accounting/periods` · `POST /api/accounting/period/close` ·
  `POST /api/accounting/period/reopen` — **manager+** period lock.
- `POST /api/tips/payout` — **manager+** pay pooled tips (Dr 2000 / Cr 1010).

## Conventions
- Gated routes use `requireAuth` + `venueFromPayload`; venue comes from the JWT
  claim, never `body`/query.
- Amounts are minor units; currency defaults KES.
- `journal_entries` is idempotent on `(venue_id, source_type, source_id)`.
- Entries are append-only + immutable; corrections are reversing entries.
- Posting hooks are best-effort and must never block the source payment/refund or
  settlement transaction.
- Pay-link payments are normal payments tagged with `pay_link_id`; they flow into
  ledger/settlement/accounting like any other payment and need no special posting.

## Guidelines
- Keep every posting rule balanced: payment Dr 1000 / Cr 4000 + 2000; refund Dr
  4900 / Cr 1000; settlement Dr 1010 + 6000 / Cr 1000; tip payout Dr 2000 / Cr
  1010; invoice issue Dr 1100 / Cr 4000 + 2100; invoice payment Dr 1000 / Cr 1100;
  COGS Dr 5000 / Cr 1200.
- **Revenue is recognised once.** Invoices use accrual: revenue + A/R are booked at
  issue (`createInvoice`, publish); the payment SETTLES A/R (no new revenue).
  Direct/POS/QR sales (no `meta.invoice_number`) are cash-basis (revenue on
  payment). A payment tagged `meta.invoice_number` routes to `recordPayment`.
- Invoice amounts are **whole KES** — scale ×100 when posting to the minor-unit
  ledger (and ÷100 when handing a payment amount back to `recordPayment`).
- Lost baskets are unpaid orders (`paid_at IS NULL`); COGS matches order items to
  inventory by name.
- Closed periods are locked: `postEntry` throws for any `entry_date` on/before a
  closed `period_end`. Correct via reopen or a reversing entry.
- `postEntry` must continue to throw on unbalanced entries; trial balance must
  always balance and balance sheet must satisfy Assets = Liabilities + Equity.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
