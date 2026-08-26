-- Phase 2 staff credential hardening.
-- Replaces globally unique plaintext PINs with venue/account-scoped, salted
-- memory-hard scrypt credentials. All legacy PINs are invalidated because the
-- committed demo values and any browser-mirrored values are already compromised.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS login_handle TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS failed_pin_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS credential_reset_required BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS credential_changed_at TIMESTAMPTZ;

-- Backfill a venue-local login handle only for an unambiguous normalized phone.
WITH normalized AS (
  SELECT id, venue_id,
    CASE
      WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
        THEN '+254' || substring(regexp_replace(phone, '[^0-9]', '', 'g') FROM 2)
      WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') ~ '^254[0-9]{9}$'
        THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
      WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') ~ '^[0-9]{9}$'
        THEN '+254' || regexp_replace(phone, '[^0-9]', '', 'g')
      WHEN regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') ~ '^[1-9][0-9]{8,14}$'
        THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
      ELSE NULL
    END AS handle
  FROM staff
), candidates AS (
  SELECT id, venue_id, handle,
         count(*) OVER (PARTITION BY venue_id, handle) AS copies
  FROM normalized
  WHERE handle IS NOT NULL
)
UPDATE staff s
SET login_handle = candidates.handle
FROM candidates
WHERE s.id = candidates.id
  AND candidates.copies = 1
  AND s.login_handle IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_venue_login_handle_uidx
  ON staff (venue_id, lower(login_handle))
  WHERE login_handle IS NOT NULL;

-- Never preserve a legacy reusable credential. The manager/verified staff member
-- must issue a fresh 6-8 digit PIN after this migration.
UPDATE staff
SET pin = NULL,
    pin_hash = NULL,
    failed_pin_attempts = 0,
    pin_locked_until = NULL,
    credential_reset_required = true
WHERE pin IS NOT NULL OR pin_hash IS NULL;

DROP INDEX IF EXISTS staff_pin_idx;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_plaintext_pin_forbidden'
      AND conrelid = 'staff'::regclass
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_plaintext_pin_forbidden CHECK (pin IS NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_failed_pin_attempts_nonnegative'
      AND conrelid = 'staff'::regclass
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_failed_pin_attempts_nonnegative
      CHECK (failed_pin_attempts >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_credential_version_positive'
      AND conrelid = 'staff'::regclass
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_credential_version_positive
      CHECK (credential_version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_pin_hash_format'
      AND conrelid = 'staff'::regclass
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_pin_hash_format CHECK (
        pin_hash IS NULL OR
        pin_hash ~ '^scrypt[$]v1[$][1-9][0-9]*[$][1-9][0-9]*[$][1-9][0-9]*[$][0-9a-f]{32}[$][0-9a-f]{64}$'
      );
  END IF;
END
$constraints$;

-- Purge PIN fields from legacy browser state mirrored into PostgreSQL.
UPDATE merchant_state ms
SET value = (
      SELECT COALESCE(
        jsonb_agg(entry - 'pin' ORDER BY ordinal),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(ms.value)
           WITH ORDINALITY AS rows(entry, ordinal)
    ),
    updated_at = now()
WHERE jsonb_typeof(ms.value) = 'array'
  AND (
    ms.skey = 'fxengine.staff'
    OR ms.skey LIKE 'fxengine.staff::%'
    OR ms.skey = 'fxengine.merchant.staffMembers'
    OR ms.skey LIKE 'fxengine.merchant.staffMembers::%'
  );

UPDATE merchant_state ms
SET value = jsonb_set(
      ms.value,
      '{staffMembers}',
      (
        SELECT COALESCE(
          jsonb_agg(entry - 'pin' ORDER BY ordinal),
          '[]'::jsonb
        )
        FROM jsonb_array_elements(ms.value -> 'staffMembers')
             WITH ORDINALITY AS rows(entry, ordinal)
      ),
      false
    ),
    updated_at = now()
WHERE jsonb_typeof(ms.value -> 'staffMembers') = 'array';
