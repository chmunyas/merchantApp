-- Store the settling payment reference (e.g. the M-Pesa receipt) on the invoice
-- so the same reference is visible to the customer (on the pay/receipt page) and
-- to the merchant/staff (on the invoices dashboard). Set when a payment carrying
-- the invoice number settles the receivable.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_ref text;
