-- Step-up confirmation for staff payout destinations (B4.1 hardening).
-- Changing where a person's tips are paid is an account-takeover target: a
-- borrowed staff session was previously enough to repoint every future payout.
-- A destination may now only be written after the staff member proves control of
-- the phone number held on their OWN staff row, via a one-time code delivered on
-- WhatsApp. These columns record which number confirmed the current destination
-- so the proof is auditable after the fact.
--
-- Existing rows are backfilled to NULL, i.e. "never confirmed". Nothing is
-- deleted and no payout is blocked by this migration alone: existing
-- destinations keep paying, but the next CHANGE to one requires a code.
ALTER TABLE staff_payout_details
  ADD COLUMN IF NOT EXISTS confirmed_via_phone TEXT;
ALTER TABLE staff_payout_details
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- The code is bound to one staff member for one purpose, so a login code can
-- never be replayed to move someone's bank details (and vice versa). Codes live
-- in auth_otps; this index keeps the "newest live code for this purpose" lookup
-- off a sequential scan as that table grows.
CREATE INDEX IF NOT EXISTS auth_otps_purpose_live_idx
  ON auth_otps (purpose, destination, created_at DESC)
  WHERE consumed_at IS NULL;
