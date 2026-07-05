-- =====================================================================
-- P2 Intelligence: Knowledge Base (RAG), Sequences (drip), Templates.
-- FULLY ADDITIVE + IDEMPOTENT. Requires the pgvector extension already
-- used by ai_memory (vector(768)).
-- =====================================================================

-- 1. Knowledge Base — FAQ/policy articles the agent can answer from.
--    Vector search when embeddings exist; GIN full-text search otherwise.
CREATE TABLE IF NOT EXISTS kb_articles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  tags       text[] NOT NULL DEFAULT '{}',
  embedding  vector(768),
  tsv        tsvector GENERATED ALWAYS AS
               (to_tsvector('english', title || ' ' || body)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_articles_tsv_idx ON kb_articles USING gin (tsv);
CREATE INDEX IF NOT EXISTS kb_articles_venue_idx ON kb_articles (venue_id);

INSERT INTO kb_articles (venue_id, title, body, tags)
SELECT 'main', title, body, tags FROM (VALUES
  ('Opening hours',
   'We are open daily from 12:00 to 23:00, including weekends and public holidays.',
   ARRAY['hours','open','close']),
  ('Parking',
   'Free customer parking is available at the rear of the restaurant, with 20 bays and two accessible spaces.',
   ARRAY['parking','car']),
  ('WiFi',
   'Free high-speed guest WiFi is available. Ask any staff member for the current password.',
   ARRAY['wifi','internet']),
  ('Dietary options',
   'We offer vegetarian, vegan and gluten-free dishes, clearly marked on the menu. Please tell us about any allergies when booking.',
   ARRAY['vegan','vegetarian','gluten','allergy','dietary','halal']),
  ('Cancellation policy',
   'You can cancel or change a booking up to 4 hours before your reservation at no charge. Later cancellations for groups of 8 or more may incur a fee.',
   ARRAY['cancel','cancellation','refund','policy']),
  ('Private events',
   'We host private events and functions for up to 60 guests. Contact us for a bespoke menu and a quote.',
   ARRAY['private','events','function','party'])
) AS seed(title, body, tags)
WHERE NOT EXISTS (SELECT 1 FROM kb_articles WHERE venue_id = 'main');

-- 2. Sequences — scheduled multi-step drip follow-ups.
CREATE TABLE IF NOT EXISTS sequences (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  name       text NOT NULL,
  channel    text NOT NULL DEFAULT 'whatsapp',
  steps      jsonb NOT NULL DEFAULT '[]',       -- [{ delayHours, message }]
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id  uuid REFERENCES sequences(id) ON DELETE CASCADE,
  venue_id     text NOT NULL,
  handle       text NOT NULL,
  channel      text NOT NULL,
  name         text,
  step_index   int NOT NULL DEFAULT 0,
  next_step_at timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'active',  -- active | done | cancelled
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seq_enroll_due_idx
  ON sequence_enrollments (venue_id, status, next_step_at);

INSERT INTO sequences (venue_id, name, channel, steps)
SELECT 'main', 'Welcome drip', 'whatsapp',
  '[{"delayHours":0,"message":"Thanks for reaching out to {{venue}}! Reply BOOK to reserve a table."},
    {"delayHours":24,"message":"Still thinking about a visit, {{name}}? We have availability this week — happy to help you book."}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM sequences WHERE venue_id = 'main');

-- 3. Reusable message templates.
CREATE TABLE IF NOT EXISTS message_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  name       text NOT NULL,
  category   text NOT NULL DEFAULT 'general',
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO message_templates (venue_id, name, category, body)
SELECT 'main', name, category, body FROM (VALUES
  ('Booking confirmation', 'booking', 'Hi {{name}}, your table at {{venue}} is confirmed. See you soon!'),
  ('Booking reminder', 'booking', 'Reminder: your booking at {{venue}} is today. Reply CANCEL to cancel.'),
  ('Win-back', 'marketing', 'We miss you at {{venue}}, {{name}}! Enjoy 15% off your next visit this week.')
) AS seed(name, category, body)
WHERE NOT EXISTS (SELECT 1 FROM message_templates WHERE venue_id = 'main');
