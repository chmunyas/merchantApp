-- Auth-backed staff PIN + dummy staff for the demo venues. A 4-digit PIN maps to
-- a staff row. POST /api/auth/staff-login verifies it and mints a staff JWT
-- (role=staff, venue + staff_id) so staff get a real token. Additive + idempotent.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS pin TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS staff_pin_idx ON staff (pin) WHERE pin IS NOT NULL;

INSERT INTO staff (venue_id, name, role, phone, pin)
SELECT v.venue_id, v.name, v.role, v.phone, v.pin
FROM (VALUES
  ('main',   'James K.', 'Manager', '+254700000001', '1234'),
  ('main',   'Amina O.', 'Server',  '+254700000002', '1235'),
  ('main',   'David M.', 'Server',  '+254700000003', '1236'),
  ('main',   'Grace W.', 'Kitchen', '+254700000004', '1237'),
  ('cbd',    'Peter N.', 'Manager', '+254700000011', '2234'),
  ('cbd',    'Lucy A.',  'Server',  '+254700000012', '2235'),
  ('cbd',    'John K.',  'Server',  '+254700000013', '2236'),
  ('kisumu', 'Mary W.',  'Manager', '+254700000021', '3234'),
  ('kisumu', 'Brian O.', 'Server',  '+254700000022', '3235'),
  ('kisumu', 'Faith M.', 'Kitchen', '+254700000023', '3236')
) AS v(venue_id, name, role, phone, pin)
WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.pin = v.pin);
