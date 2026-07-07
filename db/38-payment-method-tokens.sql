-- =====================================================================
-- Live saved cards / wallets (Apple Pay / Google Pay) on customer_payment_methods.
-- PesaSwap tokenises the card/wallet (SAQ-A: we only ever hold the token + a
-- brand/last4 for display), delivered on the payment webhook. Additive.
-- =====================================================================
ALTER TABLE customer_payment_methods ADD COLUMN IF NOT EXISTS provider_ref text; -- PesaSwap payment_method id/token
ALTER TABLE customer_payment_methods ADD COLUMN IF NOT EXISTS brand text;        -- visa | mastercard | apple_pay | google_pay
ALTER TABLE customer_payment_methods ADD COLUMN IF NOT EXISTS last4 text;

-- Re-key so a phone can hold ONE M-Pesa method + MANY cards/wallets (each a distinct
-- provider token). M-Pesa (no provider_ref) collapses to its kind.
DROP INDEX IF EXISTS cpm_phone_kind_idx;
CREATE UNIQUE INDEX IF NOT EXISTS cpm_phone_method_idx
  ON customer_payment_methods (phone, COALESCE(provider_ref, kind));
