-- C6.1/C6.5/C6.7/C6.8-C6.13 + A6.2/A6.4/A6.6 — the Sunday-style dynamic menu:
-- a venue-level enable toggle that supersedes the external (PDF/link) menu,
-- server-authoritative menus with a header image, active/pay-at-table flags,
-- a per-menu visibility schedule and a display order, per-product guest-facing
-- overrides (name, allergens, tags, photo, video), manually configured related
-- products (upsells) and a cache for AI menu translations.
--
-- Deliberately NOT modelled here (blocked on C5, the POS integration):
--   * No POS catalogue mirror, no locked "blue menu", no price/VAT lock, no
--     add-on/modifier inheritance and no resync id-diffing. Those are C6.2,
--     C6.4, C6.6 and C6.14 and cannot be honest until a POS check exists.
--   * `menus.source` is therefore always 'local' today. The column exists so a
--     later POS import can mark rows without another rewrite; nothing reads it
--     as a lock yet.
--
-- Nothing is deleted, defaulted destructively or backfilled NOT NULL over
-- existing data: every venue starts with the dynamic menu OFF, which preserves
-- exactly today's behaviour (the flat `menu_items` list) until a merchant opts
-- in. Additive + idempotent.

-- ---------------------------------------------------------------------------
-- 1. C6.1 / C6.12 / C6.13 — venue-level menu settings.
-- ---------------------------------------------------------------------------
-- The dynamic menu and the external menu are MUTUALLY EXCLUSIVE at serve time,
-- matching Sunday's toggle copy: "Enable dynamic menu (this will disable the
-- PDF menu and can be turned off at any time)". The external menu is retained
-- in the row rather than erased precisely so that "turned off at any time"
-- restores it; resolution order lives in src/lib/menu-visibility.ts.
CREATE TABLE IF NOT EXISTS venue_menu_settings (
  venue_id              TEXT PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  dynamic_menu_enabled  BOOLEAN NOT NULL DEFAULT false,
  default_language      TEXT NOT NULL DEFAULT 'en',
  -- Additional guest languages. Translated automatically with AI, cached in
  -- menu_translations. An empty array means "original language only".
  languages             TEXT[] NOT NULL DEFAULT '{}',
  external_menu_name    TEXT,
  external_menu_kind    TEXT,
  external_menu_url     TEXT,
  checkout_upsell_title TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE venue_menu_settings
  DROP CONSTRAINT IF EXISTS venue_menu_settings_external_kind_known;
ALTER TABLE venue_menu_settings
  ADD CONSTRAINT venue_menu_settings_external_kind_known
  CHECK (external_menu_kind IS NULL OR external_menu_kind IN ('pdf', 'link'));

ALTER TABLE venue_menu_settings
  DROP CONSTRAINT IF EXISTS venue_menu_settings_default_language_tag;
ALTER TABLE venue_menu_settings
  ADD CONSTRAINT venue_menu_settings_default_language_tag
  CHECK (default_language ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$');

-- ---------------------------------------------------------------------------
-- 2. C6.8 / C6.9 / C6.11 — venue-authored menus.
-- ---------------------------------------------------------------------------
-- Menus are INACTIVE by default, as in Sunday: creating a menu never publishes
-- it. display_order is the landing-page order (lowest first).
CREATE TABLE IF NOT EXISTS menus (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,
  header_image_url        TEXT,
  -- Authorable alt text. Images must never be the only carrier of meaning.
  header_image_alt        TEXT,
  is_active               BOOLEAN NOT NULL DEFAULT false,
  visible_on_pay_at_table BOOLEAN NOT NULL DEFAULT true,
  display_order           INTEGER NOT NULL DEFAULT 0,
  source                  TEXT NOT NULL DEFAULT 'local',
  revision                BIGINT NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE menus DROP CONSTRAINT IF EXISTS menus_source_known;
ALTER TABLE menus ADD CONSTRAINT menus_source_known
  CHECK (source IN ('local', 'pos'));

CREATE INDEX IF NOT EXISTS menus_venue_order_idx
  ON menus (venue_id, display_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS menus_venue_name_key
  ON menus (venue_id, lower(name));

-- ---------------------------------------------------------------------------
-- 3. C6.10 — visibility schedule, at MENU level only.
-- ---------------------------------------------------------------------------
-- Sunday's own FAQ is explicit that visibility cannot be set per category: a
-- venue that wants different hours for desserts must create a second menu. We
-- match that deliberately rather than over-engineering per-category windows.
--
-- Times are minutes past local midnight in the VENUE timezone, inclusive at
-- both ends so Sunday's documented "09:00 to 14:59" lunch window behaves as
-- written. end_minutes < start_minutes means the window runs past midnight.
CREATE TABLE IF NOT EXISTS menu_visibility_windows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  menu_id       UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL,
  start_minutes SMALLINT NOT NULL,
  end_minutes   SMALLINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE menu_visibility_windows
  DROP CONSTRAINT IF EXISTS menu_visibility_windows_bounds;
ALTER TABLE menu_visibility_windows
  ADD CONSTRAINT menu_visibility_windows_bounds
  CHECK (
    day_of_week BETWEEN 0 AND 6
    AND start_minutes BETWEEN 0 AND 1439
    AND end_minutes BETWEEN 0 AND 1439
  );

CREATE INDEX IF NOT EXISTS menu_visibility_windows_menu_idx
  ON menu_visibility_windows (venue_id, menu_id, day_of_week);

-- ---------------------------------------------------------------------------
-- 4. Menu composition — ordered categories drawn from menu_items.category.
-- ---------------------------------------------------------------------------
-- A local category is just a named, ordered slice of the venue's items. POS
-- category import and the "convert to sunday" unlock are C6.4 and are NOT here.
CREATE TABLE IF NOT EXISTS menu_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  menu_id       UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS menu_categories_menu_name_key
  ON menu_categories (venue_id, menu_id, lower(name));

CREATE INDEX IF NOT EXISTS menu_categories_menu_order_idx
  ON menu_categories (venue_id, menu_id, display_order);

-- ---------------------------------------------------------------------------
-- 5. C6.5 / A6.4 — per-product guest-facing overrides.
-- ---------------------------------------------------------------------------
-- display_name is the guest-friendly name shown instead of the operational
-- name. Allergens and tags are TEXT so they can be READ OUT as words: they are
-- never conveyed by colour or icon alone. image_alt/video_description are
-- authorable so the merchant, not the code, writes the accessible description.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allergens TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_alt TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS video_description TEXT;

-- Sunday blocks the video field until a still image exists, because a slow
-- connection must still show the dish. Enforced in the database too, so the
-- API and any future importer cannot bypass it.
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_video_needs_image;
ALTER TABLE menu_items ADD CONSTRAINT menu_items_video_needs_image
  CHECK (video_url IS NULL OR image_url IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 6. C6.7 / A6.6 — related products (upsells), configured MANUALLY.
-- ---------------------------------------------------------------------------
-- Product-level, not category-level: if a product appears in several menus the
-- same suggestion follows it everywhere, which is why this hangs off the item
-- and not off a menu.
CREATE TABLE IF NOT EXISTS menu_item_upsells (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  item_id           UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  suggested_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  display_order     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE menu_item_upsells DROP CONSTRAINT IF EXISTS menu_item_upsells_not_self;
ALTER TABLE menu_item_upsells ADD CONSTRAINT menu_item_upsells_not_self
  CHECK (item_id <> suggested_item_id);

CREATE UNIQUE INDEX IF NOT EXISTS menu_item_upsells_pair_key
  ON menu_item_upsells (venue_id, item_id, suggested_item_id);

CREATE INDEX IF NOT EXISTS menu_item_upsells_item_idx
  ON menu_item_upsells (venue_id, item_id, display_order);

-- Checkout recommendations: one titled block per venue, up to five products.
-- The five-item ceiling is enforced in src/lib/menu-upsell.ts (MAX_CHECKOUT_UPSELLS).
CREATE TABLE IF NOT EXISTS menu_checkout_upsells (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  item_id       UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS menu_checkout_upsells_item_key
  ON menu_checkout_upsells (venue_id, item_id);

CREATE INDEX IF NOT EXISTS menu_checkout_upsells_order_idx
  ON menu_checkout_upsells (venue_id, display_order);

-- ---------------------------------------------------------------------------
-- 7. A6.2 / C6.13 — AI translation cache.
-- ---------------------------------------------------------------------------
-- source_hash pins the translation to the exact source text it was produced
-- from, so editing a dish name invalidates only that row. A guest is never
-- shown a stale or empty translation: the reader falls back to the original
-- text whenever the hash does not match or the row is missing.
CREATE TABLE IF NOT EXISTS menu_translations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  name        TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE menu_translations DROP CONSTRAINT IF EXISTS menu_translations_entity_known;
ALTER TABLE menu_translations ADD CONSTRAINT menu_translations_entity_known
  CHECK (entity_type IN ('item', 'menu', 'category'));

CREATE UNIQUE INDEX IF NOT EXISTS menu_translations_entity_key
  ON menu_translations (venue_id, lang, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS menu_translations_venue_lang_idx
  ON menu_translations (venue_id, lang);
