-- C5.1 / C5.5 — the read-only half of the POS connector framework: a venue's POS
-- connection, the open checks pulled from it, and their lines. This is what lets
-- a guest's digital bill BE the POS check (A1.1-A1.3) instead of an order we
-- happened to take ourselves.
--
-- Deliberately NOT here (they are the next phases, and batching them would make
-- this file mean two things):
--   * Tender push-back, the `sunday` / exception tender map and the
--     Notified / Not Notified projection — C5.6, C5.7, C5.11, B2.9.
--   * POS-side payment records and reconciliation runs — C3.
--   * Staff <-> POS cashier links — B1.5.
--
-- NO CREDENTIAL IS STORED HERE. A POS API key, OAuth token or client secret is a
-- Worker secret, never a column and never `app_settings` — the same rule the
-- provider and channel integrations already follow. This table holds only the
-- public identifiers needed to address the right restaurant, plus the
-- capabilities the connector reported.
--
-- Additive + idempotent. Every venue starts with no connection, which is exactly
-- today's behaviour: orders stay self-authored and no bill is POS-derived.

-- ---------------------------------------------------------------------------
-- 1. C5.1 — the connection.
-- ---------------------------------------------------------------------------
-- `capabilities` is the connector's OWN declaration of what this provider can
-- do (check.pull, tender.push, menu.sync, reconciliation.export, staff.list,
-- modifiers). It is stored rather than inferred so the dashboard can state a
-- degradation honestly — Sunday publishes that line-by-line reconciliation is
-- unavailable on Clover, Comtrex, PI Electronique and Zonal, and that menu sync
-- covers only some providers, so "this POS cannot do X" is a first-class answer.
CREATE TABLE IF NOT EXISTS pos_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id             TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft',
  -- The provider's own id for this restaurant/location (Toast restaurant GUID,
  -- Omnivore location id, ...). Public routing data, not a credential.
  external_location_id TEXT,
  capabilities         TEXT[] NOT NULL DEFAULT '{}',
  -- Non-secret connector settings only (base url, timezone hint, poll seconds).
  config               JSONB NOT NULL DEFAULT '{}',
  verified_at          TIMESTAMPTZ,
  verified_by          TEXT,
  last_sync_at         TIMESTAMPTZ,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_status_known;
ALTER TABLE pos_connections ADD CONSTRAINT pos_connections_status_known
  CHECK (status IN ('draft', 'connected', 'disabled', 'error'));

-- A venue has one live POS. Older/disabled rows are kept for audit rather than
-- deleted, so the partial index carries the invariant instead of a bare UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS pos_connections_one_live_per_venue
  ON pos_connections (venue_id)
  WHERE status = 'connected';

CREATE INDEX IF NOT EXISTS pos_connections_venue_idx
  ON pos_connections (venue_id, status);

-- ---------------------------------------------------------------------------
-- 2. C5.5 — open checks pulled from the POS.
-- ---------------------------------------------------------------------------
-- Money is in MINOR units, as everywhere else in this codebase.
--
-- `service_charge_minor` is the auto-gratuity the tip tiers in `src/lib/tip-tiers.ts`
-- (A3.2) have been waiting for: db/68 gave `orders.service_charge` a home and
-- nothing has been able to populate it. This column is where it comes from.
--
-- `covers` is the guest count. It is the missing denominator for revenue-per-guest
-- (D4.9) and adoption (D2.2); both are unbuildable without it, which is why it is
-- pulled here rather than guessed.
--
-- `raw` keeps the provider's original payload so a mapping bug is diagnosable
-- after the fact without re-pulling a check that may since have closed.
CREATE TABLE IF NOT EXISTS pos_checks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id             TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  connection_id        UUID NOT NULL REFERENCES pos_connections(id) ON DELETE CASCADE,
  pos_bill_id          TEXT NOT NULL,
  pos_check_number     TEXT,
  -- The POS's own table identifier, matched to `dining_tables.pos_table_ref`.
  pos_table_ref        TEXT,
  table_id             UUID REFERENCES dining_tables(id) ON DELETE SET NULL,
  pos_server_id        TEXT,
  pos_server_name      TEXT,
  revenue_centre       TEXT,
  service              TEXT,
  covers               INTEGER,
  currency             TEXT NOT NULL DEFAULT 'KES',
  subtotal_minor       BIGINT NOT NULL DEFAULT 0,
  tax_minor            BIGINT NOT NULL DEFAULT 0,
  service_charge_minor BIGINT NOT NULL DEFAULT 0,
  discount_minor       BIGINT NOT NULL DEFAULT 0,
  total_minor          BIGINT NOT NULL DEFAULT 0,
  paid_minor           BIGINT NOT NULL DEFAULT 0,
  opened_at            TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  raw                  JSONB NOT NULL DEFAULT '{}',
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pos_checks DROP CONSTRAINT IF EXISTS pos_checks_amounts_non_negative;
ALTER TABLE pos_checks ADD CONSTRAINT pos_checks_amounts_non_negative
  CHECK (
    subtotal_minor >= 0 AND tax_minor >= 0 AND service_charge_minor >= 0
    AND discount_minor >= 0 AND total_minor >= 0 AND paid_minor >= 0
    AND (covers IS NULL OR covers >= 0)
  );

-- The POS's bill id is the identity of a check. Re-pulling the same check
-- updates it in place rather than creating a second copy, so the pull worker is
-- safe to run as often as the connector's freshness allows.
CREATE UNIQUE INDEX IF NOT EXISTS pos_checks_bill_key
  ON pos_checks (venue_id, pos_bill_id);

CREATE INDEX IF NOT EXISTS pos_checks_open_idx
  ON pos_checks (venue_id, table_id)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS pos_checks_service_idx
  ON pos_checks (venue_id, opened_at DESC);

-- ---------------------------------------------------------------------------
-- 3. C5.5 / A1.2 — the itemised lines the guest reads.
-- ---------------------------------------------------------------------------
-- `modifiers` holds the POS's add-ons verbatim (C6.6 / A6.5: "Size: Large",
-- "Extra sauce"). They are retrieved, never authored here — a merchant edits
-- them in the POS.
CREATE TABLE IF NOT EXISTS pos_check_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  check_id         UUID NOT NULL REFERENCES pos_checks(id) ON DELETE CASCADE,
  pos_line_id      TEXT NOT NULL,
  pos_item_id      TEXT,
  name             TEXT NOT NULL,
  category         TEXT,
  qty              NUMERIC(12, 3) NOT NULL DEFAULT 1,
  unit_price_minor BIGINT NOT NULL DEFAULT 0,
  total_minor      BIGINT NOT NULL DEFAULT 0,
  modifiers        JSONB NOT NULL DEFAULT '[]',
  voided           BOOLEAN NOT NULL DEFAULT false,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_check_lines_key
  ON pos_check_lines (venue_id, check_id, pos_line_id);

CREATE INDEX IF NOT EXISTS pos_check_lines_check_idx
  ON pos_check_lines (venue_id, check_id, display_order);

-- ---------------------------------------------------------------------------
-- 4. Mapping our floor to the POS's floor.
-- ---------------------------------------------------------------------------
-- Sunday treats the floor plan as connected to QR assignment and to pay-at-table
-- working at all, and does not let a venue re-map it self-serve. We store the
-- mapping per table so a re-map is data, not a migration.
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS pos_table_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS dining_tables_pos_ref_key
  ON dining_tables (venue_id, pos_table_ref)
  WHERE pos_table_ref IS NOT NULL;

-- An order that came from a POS check points at it. NULL means the order is
-- self-authored, which is every existing row and every venue without a POS.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pos_check_id UUID;

CREATE INDEX IF NOT EXISTS orders_pos_check_idx
  ON orders (pos_check_id)
  WHERE pos_check_id IS NOT NULL;
