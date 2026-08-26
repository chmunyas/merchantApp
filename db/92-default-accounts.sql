-- Migration 92: Default Admin, Merchant, and Staff Accounts.
-- Provisions default venue 'main', merchant accounts, and 2 staff members with salted scrypt credentials.

INSERT INTO venues (id, name, code, active) VALUES
  ('main', 'Sade''s Atelier — Westlands', 'WL-001', true)
ON CONFLICT (id) DO NOTHING;

-- Merchant accounts (email/password login via /api/auth/login)
-- Password for merchant@pesaswap.io and merchant@demo.com is: MerchantPass123!
INSERT INTO app_users (email, password_hash, name, phone, venue_id, role, plan)
VALUES
  (
    'merchant@pesaswap.io',
    'pbkdf2$100000$Mi21gVmoYd3da6hTw1lCRw$ZtngYyjeyhCYDh682YMUtO7XQ9_tLkcCKAksly4MDms',
    'Sade Operator',
    '+254712345678',
    'main',
    'merchant',
    'growth'
  ),
  (
    'merchant@demo.com',
    'pbkdf2$100000$Mi21gVmoYd3da6hTw1lCRw$ZtngYyjeyhCYDh682YMUtO7XQ9_tLkcCKAksly4MDms',
    'Demo Merchant',
    '+254712345678',
    'main',
    'merchant',
    'growth'
  )
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  venue_id = EXCLUDED.venue_id,
  role = EXCLUDED.role;

-- Bind user to venue
INSERT INTO user_venues (user_id, venue_id, role)
SELECT id, venue_id, role FROM app_users WHERE venue_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Staff 1: Grace Wanjiku (Account: +254712345678 / 0712345678, PIN: 123456)
-- Staff 2: James Mwangi  (Account: +254723456789 / 0723456789, PIN: 654321)
INSERT INTO staff (
  venue_id, name, role, phone, login_handle, pin_hash, active, credential_reset_required, credential_version
) VALUES
  (
    'main',
    'Grace Wanjiku',
    'waiter',
    '+254712345678',
    '+254712345678',
    'scrypt$v1$32768$8$1$b8062b896d571ae743c706ddfb4d0618$2a2a6e288fdf5584662c7512bf4ad3d45cc4c2abf9a1dabbe5d289c5128cf3ea',
    true,
    false,
    1
  ),
  (
    'main',
    'James Mwangi',
    'bartender',
    '+254723456789',
    '+254723456789',
    'scrypt$v1$32768$8$1$f341802b27385baf310ba1403b562856$dcbd06b780e442648476c39909c2b6ab0c4ba59689d277314e49d0e9e2667d0e',
    true,
    false,
    1
  )
ON CONFLICT (venue_id, lower(login_handle)) WHERE login_handle IS NOT NULL DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  pin_hash = EXCLUDED.pin_hash,
  active = true,
  credential_reset_required = false;
