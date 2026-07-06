CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL,
  name text NOT NULL,
  description text,
  points_cost int NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_rewards_venue_idx
  ON loyalty_rewards (venue_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL,
  phone text,
  contact_id uuid,
  reward_id uuid,
  points_spent int NOT NULL DEFAULT 0,
  code text,
  status text NOT NULL DEFAULT 'issued',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_redemptions_venue_phone_idx
  ON reward_redemptions (venue_id, phone, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_tokens (
  token text PRIMARY KEY,
  venue_id text NOT NULL,
  phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_tokens_venue_phone_idx
  ON portal_tokens (venue_id, phone, created_at DESC);

INSERT INTO loyalty_rewards (venue_id, name, description, points_cost)
SELECT 'main', 'Free coffee', 'Redeem for one regular coffee.', 50
WHERE NOT EXISTS (
  SELECT 1 FROM loyalty_rewards WHERE venue_id = 'main' AND name = 'Free coffee'
);

INSERT INTO loyalty_rewards (venue_id, name, description, points_cost)
SELECT 'main', 'KES 250 bill credit', 'Use this credit on your next visit.', 250
WHERE NOT EXISTS (
  SELECT 1 FROM loyalty_rewards WHERE venue_id = 'main' AND name = 'KES 250 bill credit'
);

INSERT INTO loyalty_rewards (venue_id, name, description, points_cost)
SELECT 'main', 'Priority table upgrade', 'Get priority seating when available.', 400
WHERE NOT EXISTS (
  SELECT 1 FROM loyalty_rewards WHERE venue_id = 'main' AND name = 'Priority table upgrade'
);
