-- Per-tenant plan for usage limits / billing tiers.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
