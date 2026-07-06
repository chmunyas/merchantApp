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
Payments, refunds, settlement batches, tip payouts, and manual adjustments post
balanced journal entries; reports surface cash-basis P&L, balance sheet, trial
balance, per-account ledger, AR aging, and lost baskets.

## Key files
- `src/lib/accounting.ts` — chart (`CHART`), balanced line-builders, `postEntry`,
  event wrappers, and report queries.
- `src/api/accounting.ts` — gated `/api/accounting/*` routes.
- `db/30-accounting.sql` — `ledger_accounts`, `journal_entries`,
  `journal_lines`; amounts are minor units (cents).
- `src/api/payments.ts` (`recordLedger`) + `src/api/settlement.ts` — best-effort
  hooks that post payment/refund/settlement entries.
- `src/routes/dashboard/accounting.tsx` — accounting dashboard UI.

## Endpoints (all gated)
- `GET /api/accounting/chart` — chart of accounts.
- `GET /api/accounting/trial-balance?from=&to=` — debits/credits; must balance.
- `GET /api/accounting/income-statement?from=&to=` — P&L.
- `GET /api/accounting/balance-sheet?asOf=` — rolls P&L into retained earnings.
- `GET /api/accounting/journal?from=&to=&limit=` — journal entries + lines.
- `GET /api/accounting/ledger/:code?from=&to=` — account ledger + running balance.
- `GET /api/accounting/ar-aging` — invoices as the AR subledger.
- `GET /api/accounting/lost-basket?from=&to=` — unpaid orders subledger.
- `GET /api/accounting/summary?from=&to=` — dashboard rollup.
- `POST /api/accounting/journal` — **manager+** manual balanced adjustment.

## Conventions
- Gated routes use `requireAuth` + `venueFromPayload`; venue comes from the JWT
  claim, never `body`/query.
- Amounts are minor units; currency defaults KES.
- `journal_entries` is idempotent on `(venue_id, source_type, source_id)`.
- Entries are append-only + immutable; corrections are reversing entries.
- Posting hooks are best-effort and must never block the source payment/refund or
  settlement transaction.

## Guidelines
- Keep every posting rule balanced: payment Dr 1000 / Cr 4000 + 2000; refund Dr
  4900 / Cr 1000; settlement Dr 1010 + 6000 / Cr 1000; tip payout Dr 2000 / Cr
  1010.
- Revenue is cash-basis: book sales only when payment succeeds.
- Invoices are an Accounts-Receivable subledger (`arAging`), not accrual revenue;
  lost baskets are unpaid orders (`paid_at IS NULL`).
- `postEntry` must continue to throw on unbalanced entries; trial balance must
  always balance and balance sheet must satisfy Assets = Liabilities + Equity.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
