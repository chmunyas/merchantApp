-- =====================================================================
-- Menu items (so the AI agent can answer "menu / prices" in natural
-- language across channels). Additive + idempotent.
-- =====================================================================
CREATE TABLE IF NOT EXISTS menu_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL,
  name       text NOT NULL,
  category   text NOT NULL DEFAULT 'Mains',
  price      numeric NOT NULL,
  currency   text NOT NULL DEFAULT 'KES',
  description text,
  dietary    text[] NOT NULL DEFAULT '{}',
  available  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS menu_items_venue_idx ON menu_items (venue_id);

INSERT INTO menu_items (venue_id, name, category, price, dietary, available)
SELECT 'main', name, category, price, dietary, available FROM (VALUES
  ('Nyama Choma Platter', 'Mains', 1450, ARRAY['halal','gluten-free'], true),
  ('Grilled Tilapia', 'Mains', 1280, ARRAY['gluten-free'], true),
  ('Vegetable Pilau', 'Mains', 780, ARRAY['vegetarian'], true),
  ('Chicken Wings', 'Sides', 640, ARRAY['halal'], true),
  ('Sukuma Wiki', 'Sides', 280, ARRAY['vegan','gluten-free'], true),
  ('Chapati', 'Sides', 220, ARRAY['vegetarian'], true),
  ('Tusker Lager', 'Drinks', 340, ARRAY['vegan'], true),
  ('Passion Soda', 'Drinks', 180, ARRAY['vegan','gluten-free'], false),
  ('Aperol Spritz', 'Cocktails', 760, ARRAY['vegan'], true),
  ('Dawa Martini', 'Cocktails', 820, ARRAY['gluten-free'], true),
  ('Chocolate Fudge Cake', 'Desserts', 420, ARRAY['vegetarian'], true),
  ('Mandazi Sundae', 'Desserts', 390, ARRAY['vegetarian'], true)
) AS seed(name, category, price, dietary, available)
WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE venue_id = 'main');
