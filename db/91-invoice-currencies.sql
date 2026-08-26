-- Allow invoicing in the agreed currency set; keep KES as the default.
--
-- Migration 64 pinned invoices to KES with CHECK (currency = 'KES') because the
-- ledger had no multi-currency story. It does now: journal_entries carries a
-- currency and every accounting report (trial balance, P&L, balance sheet,
-- AR aging) filters on it, so balances are held per currency and are never
-- summed across currencies.
--
-- Scope note: this relaxes CAPTURE currencies only — invoices and their
-- recurring schedules. The KES-only constraints on tip_pools, tip_allocations,
-- settlements, staff payout runs and payroll are deliberately LEFT IN PLACE:
-- those are Kenyan payout rails (M-Pesa / Pesalink), and a EUR payout cannot be
-- sent over them. Relaxing them would let a payout be recorded that no rail can
-- settle.
--
-- Still NOT supported, by design: FX conversion, revaluation, and consolidated
-- cross-currency reporting. Those need a rate table with effective dating and a
-- gain/loss policy.

CREATE OR REPLACE FUNCTION pesaswap_replace_currency_check(
  target_table TEXT,
  old_constraint TEXT,
  new_constraint TEXT
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass(target_table) IS NULL THEN RETURN; END IF;
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', target_table, old_constraint);
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = target_table::regclass AND conname = new_constraint
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (currency IN (''KES'',''USD'',''EUR'',''GBP'',''UGX'',''TZS''))',
      target_table, new_constraint
    );
  END IF;
END;
$$;

SELECT pesaswap_replace_currency_check('invoices', 'invoices_currency_kes', 'invoices_currency_supported');
SELECT pesaswap_replace_currency_check('recurring_invoices', 'recurring_currency_kes', 'recurring_currency_supported');

DROP FUNCTION IF EXISTS pesaswap_replace_currency_check(TEXT, TEXT, TEXT);

ALTER TABLE invoices ALTER COLUMN currency SET DEFAULT 'KES';
