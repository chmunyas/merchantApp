-- Dispute RESPONSE tooling: let a merchant contest a chargeback (submit evidence)
-- or concede it (accept). The ingest side (db/41 + the trusted webhook) records
-- the dispute; these columns capture the merchant's response + outcome. Additive.
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence_submitted_at TIMESTAMPTZ;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolution TEXT;
