-- Attribute an invoice (and thus its payment + tip) to the staff member who
-- created it, so live tips flow to the serving staff automatically. Additive.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS staff_id UUID;
