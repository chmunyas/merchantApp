-- Stores venue-local service hours and the boundary used to calculate business days.
-- Existing venues receive the Sunday-style 04:00 local boundary; service hours are initially empty.

CREATE TABLE IF NOT EXISTS venue_service_settings (
  venue_id TEXT PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  business_day_start_minutes SMALLINT NOT NULL DEFAULT 240
    CHECK (business_day_start_minutes >= 0 AND business_day_start_minutes < 1440),
  service_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venue_service_settings_venue_id_idx
  ON venue_service_settings (venue_id);
