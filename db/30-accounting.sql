-- =====================================================================
-- Double-entry general ledger (audit-grade accounting).
--
-- Every economic event (a succeeded payment, a refund, a settlement batch,
-- a tip payout, a manual adjustment) posts a BALANCED journal entry: the sum
-- of debits equals the sum of credits. Entries are append-only and immutable —
-- corrections are made with reversing entries, never edits — so the ledger is a
-- defensible audit trail. Amounts are in MINOR units (cents), matching payments.
--
-- Policy: cash-basis revenue recognition (revenue is booked when a payment
-- succeeds). Invoices are tracked as an Accounts-Receivable subledger (aging
-- report from the invoices table); abandoned orders as a lost-basket subledger.
-- Additive + idempotent.
-- =====================================================================

-- Chart of accounts (global codes, shared across venues).
CREATE TABLE IF NOT EXISTS ledger_accounts (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,        -- asset | liability | equity | revenue | contra_revenue | expense
  normal_side TEXT NOT NULL,        -- debit | credit
  sort_order  INT  NOT NULL DEFAULT 0
);

INSERT INTO ledger_accounts (code, name, type, normal_side, sort_order) VALUES
  ('1000', 'Cash & Mobile Money Clearing', 'asset',          'debit',  10),
  ('1010', 'Settled Bank',                 'asset',          'debit',  20),
  ('1100', 'Accounts Receivable',          'asset',          'debit',  30),
  ('1200', 'Inventory',                    'asset',          'debit',  40),
  ('2000', 'Tips Payable',                 'liability',      'credit', 50),
  ('2100', 'Tax Payable',                  'liability',      'credit', 60),
  ('3000', 'Owner Equity',                 'equity',         'credit', 70),
  ('4000', 'Sales Revenue',                'revenue',        'credit', 80),
  ('4900', 'Refunds & Returns',            'contra_revenue', 'debit',  90),
  ('5000', 'Cost of Goods Sold',           'expense',        'debit', 100),
  ('6000', 'Payment Processing Fees',      'expense',        'debit', 110)
ON CONFLICT (code) DO NOTHING;

-- One balanced journal entry per economic event. UNIQUE(source) makes posting
-- idempotent: re-running recordLedger for the same payment never double-posts.
CREATE TABLE IF NOT EXISTS journal_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL,
  entry_date  TIMESTAMPTZ NOT NULL DEFAULT now(),
  memo        TEXT,
  source_type TEXT NOT NULL,        -- payment | refund | settlement | tip_payout | invoice | manual
  source_id   TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'KES',
  amount      BIGINT NOT NULL DEFAULT 0,   -- total debits (= total credits)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  UNIQUE (venue_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS journal_entries_venue_date_idx
  ON journal_entries (venue_id, entry_date DESC);

-- Debit/credit lines. venue_id + entry_date are denormalized so trial balance,
-- general ledger and the financial statements are single-table aggregates.
CREATE TABLE IF NOT EXISTS journal_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  venue_id     TEXT NOT NULL,
  entry_date   TIMESTAMPTZ NOT NULL,
  account_code TEXT NOT NULL,
  debit        BIGINT NOT NULL DEFAULT 0,
  credit       BIGINT NOT NULL DEFAULT 0,
  memo         TEXT
);
CREATE INDEX IF NOT EXISTS journal_lines_venue_acct_idx
  ON journal_lines (venue_id, account_code, entry_date);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx
  ON journal_lines (entry_id);
