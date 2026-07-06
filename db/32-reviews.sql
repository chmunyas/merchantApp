-- =====================================================================
-- Reviews & guest insights — the "payment = start of the relationship"
-- reputation loop. A review is captured post-payment (overall rating + the
-- four SundayApp dimensions: food / service / ambience / value), attributed to
-- the serving staff + payment, and answered by the owner or an AI reply.
-- Additive + idempotent.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      text NOT NULL,
  rating        int  NOT NULL,          -- overall 1..5
  food          int,                    -- 1..5 dimension ratings (nullable)
  service       int,
  ambience      int,
  value         int,
  comment       text,
  customer_name text,
  phone         text,
  staff_id      uuid,
  payment_id    text,
  source        text NOT NULL DEFAULT 'app',   -- app | table | pay | qr | google
  response      text,                    -- public reply (owner or AI)
  response_ai   boolean NOT NULL DEFAULT false,
  responded_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_venue_created_idx
  ON reviews (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_venue_rating_idx
  ON reviews (venue_id, rating);
