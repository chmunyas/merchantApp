-- Loyalty is keyed on the customer PHONE NUMBER as the unique reference per venue.
-- Fold any duplicate (venue_id, phone) contacts into the earliest row, then add a
-- partial unique index so a phone is a single loyalty identity within a venue.

-- Merge duplicates: sum points/spend/visits into the earliest contact per phone.
WITH keep AS (
  SELECT venue_id, phone,
         (array_agg(id ORDER BY created_at, id))[1] AS keep_id,
         sum(points) AS points,
         sum(total_spent) AS total_spent,
         sum(visits) AS visits
  FROM contacts
  WHERE phone IS NOT NULL AND phone <> ''
  GROUP BY venue_id, phone
  HAVING count(*) > 1
)
UPDATE contacts c
SET points = keep.points, total_spent = keep.total_spent, visits = keep.visits
FROM keep
WHERE c.id = keep.keep_id;

-- Remove the merged duplicate rows, keeping only the earliest per venue+phone.
DELETE FROM contacts c
WHERE c.phone IS NOT NULL AND c.phone <> ''
  AND c.id <> (
    SELECT k.id FROM contacts k
    WHERE k.venue_id = c.venue_id AND k.phone = c.phone
    ORDER BY k.created_at, k.id
    LIMIT 1
  );

-- Enforce phone as the unique loyalty reference per venue (only where a phone exists).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_venue_phone_key
  ON contacts (venue_id, phone)
  WHERE phone IS NOT NULL AND phone <> '';
