-- Bank payouts via Pesalink: a bank CODE, not a bank name.
--
-- `staff_payout_details.bank_name` is free text, which cannot be sent to a
-- payment rail. PesaSwap routes bank payouts through PesaPay/Pesalink, which
-- requires a two-digit bank code from a fixed list (see src/lib/pesaswap-banks.ts).
-- Without this column every `method = 'bank'` destination was parked forever as
-- `held / bank_rail_unavailable` — the staff member appeared set up, and was
-- never paid.
--
-- Existing bank rows keep their free-text name and stay held until the staff
-- member re-enters their details and picks a bank from the list. That is
-- deliberate: guessing a bank code from a typed name would route someone's wages
-- to the wrong institution.
ALTER TABLE staff_payout_details ADD COLUMN IF NOT EXISTS bank_code TEXT;

DO $bank_code$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payout_details_bank_code_format'
  ) THEN
    ALTER TABLE staff_payout_details ADD CONSTRAINT staff_payout_details_bank_code_format
      CHECK (bank_code IS NULL OR bank_code ~ '^[0-9]{2}$');
  END IF;
END
$bank_code$;
