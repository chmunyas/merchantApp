-- Seed data for the PesaSwap cloud backend.
INSERT INTO venues (id, name, code, active) VALUES
  ('main',   'Sade''s Atelier — Westlands', 'WL-001',  true),
  ('cbd',    'Sade''s Atelier — CBD',       'CBD-002', true),
  ('kisumu', 'Sade''s Lakeside — Kisumu',   'KSM-003', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO contacts (venue_id, name, phone, email, tier, points, total_spent, visits, last_visit, tags) VALUES
  ('main', 'Amina Yusuf',    '+254712000001', 'amina@example.com',  'Platinum', 1200, 48000, 9, now() - interval '3 days',  ARRAY['vip','wine-club']),
  ('main', 'Brian Otieno',   '+254712000002', 'brian@example.com',  'Gold',      600, 22000, 5, now() - interval '8 days',  ARRAY['regular']),
  ('main', 'Cynthia Wambui', '+254712000003', NULL,                 'Silver',    150,  6000, 2, now() - interval '12 days', ARRAY['brunch']),
  ('main', 'Dennis Kiptoo',  '+254712000004', NULL,                 'Bronze',     40,  1500, 1, now() - interval '45 days', ARRAY['lapsed']),
  ('cbd',  'Esther Njoki',   '+254712000005', 'esther@example.com', 'Gold',      900, 33000, 7, now() - interval '6 days',  ARRAY['events'])
ON CONFLICT DO NOTHING;

INSERT INTO reservations (venue_id, customer_name, phone, table_number, covers, date, time, status) VALUES
  ('main', 'Okoro Party',  '+254790112233', 1, 8, CURRENT_DATE, '19:00', 'seated'),
  ('main', 'Njeri Family', '+254722110220', 2, 4, CURRENT_DATE, '19:30', 'confirmed'),
  ('cbd',  'Mwangi Group', '+254733221144', 6, 6, CURRENT_DATE, '20:30', 'confirmed')
ON CONFLICT DO NOTHING;

INSERT INTO enquiries (venue_id, customer_name, phone, covers, date, time, notes, status, source) VALUES
  ('main', 'Wanjiru Kamau', '+254712345678', 6,  CURRENT_DATE, '19:30', 'Anniversary dinner, terrace if possible', 'new', 'web'),
  ('main', 'Achieng Party', '+254734567890', 10, CURRENT_DATE, '20:00', 'Birthday - large table', 'new', 'web')
ON CONFLICT DO NOTHING;

INSERT INTO activity_log (venue_id, kind, summary) VALUES
  ('main', 'seed', 'Cloud backend initialised with demo data');
