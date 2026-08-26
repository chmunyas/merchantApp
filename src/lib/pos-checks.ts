// C5.1 / C5.5 — persistence for POS connections and the checks pulled from them.
//
// Every statement filters on venue_id. The decisions (what a check means, what a
// provider can do) live in the pure modules under src/lib/pos/; this file only
// reads and writes.

import type { getSql } from "@/lib/db";
import { connectorFor, credentialsFor } from "@/lib/pos/registry";
import type {
  PosCapability,
  PosCheck,
  PosContext,
  PosProvider,
  PosResult,
} from "@/lib/pos/types";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type PosConnectionRow = {
  id: string;
  venue: string;
  provider: PosProvider;
  status: "draft" | "connected" | "disabled" | "error";
  externalLocationId: string | null;
  capabilities: PosCapability[];
  config: Record<string, unknown>;
  verifiedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

function toConnection(row: Record<string, unknown>): PosConnectionRow {
  return {
    id: String(row.id),
    venue: String(row.venue_id),
    provider: row.provider as PosProvider,
    status: row.status as PosConnectionRow["status"],
    externalLocationId: (row.external_location_id as string | null) ?? null,
    capabilities: ((row.capabilities as string[]) ?? []) as PosCapability[],
    config: (row.config as Record<string, unknown>) ?? {},
    verifiedAt: row.verified_at ? new Date(row.verified_at as string).toISOString() : null,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string).toISOString() : null,
    lastError: (row.last_error as string | null) ?? null,
  };
}

export async function getConnection(
  sql: Sql,
  venue: string,
): Promise<PosConnectionRow | null> {
  const [row] = await sql`
    SELECT id, venue_id, provider, status, external_location_id, capabilities,
           config, verified_at, last_sync_at, last_error
    FROM pos_connections
    WHERE venue_id = ${venue} AND status <> 'disabled'
    ORDER BY (status = 'connected') DESC, updated_at DESC
    LIMIT 1`;
  return row ? toConnection(row) : null;
}

export async function upsertConnection(
  sql: Sql,
  venue: string,
  provider: PosProvider,
  externalLocationId: string | null,
  config: Record<string, unknown>,
): Promise<PosConnectionRow> {
  const existing = await getConnection(sql, venue);
  if (existing && existing.provider === provider) {
    const [row] = await sql`
      UPDATE pos_connections SET
        external_location_id = ${externalLocationId},
        config               = ${JSON.stringify(config)}::jsonb,
        updated_at           = now()
      WHERE id = ${existing.id} AND venue_id = ${venue}
      RETURNING id, venue_id, provider, status, external_location_id, capabilities,
                config, verified_at, last_sync_at, last_error`;
    return toConnection(row);
  }
  // Switching provider retires the old connection rather than deleting it: the
  // checks it pulled are still referenced by orders and by reconciliation.
  if (existing) {
    await sql`
      UPDATE pos_connections SET status = 'disabled', updated_at = now()
      WHERE id = ${existing.id} AND venue_id = ${venue}`;
  }
  const [row] = await sql`
    INSERT INTO pos_connections (venue_id, provider, external_location_id, config)
    VALUES (${venue}, ${provider}, ${externalLocationId}, ${JSON.stringify(config)}::jsonb)
    RETURNING id, venue_id, provider, status, external_location_id, capabilities,
              config, verified_at, last_sync_at, last_error`;
  return toConnection(row);
}

export async function markConnectionVerified(
  sql: Sql,
  venue: string,
  connectionId: string,
  actor: string,
  externalLocationId: string | null,
  capabilities: PosCapability[],
): Promise<void> {
  await sql`
    UPDATE pos_connections SET
      status               = 'connected',
      external_location_id = COALESCE(${externalLocationId}, external_location_id),
      capabilities         = ${capabilities},
      verified_at          = now(),
      verified_by          = ${actor},
      last_error           = NULL,
      updated_at           = now()
    WHERE id = ${connectionId} AND venue_id = ${venue}`;
}

export async function markConnectionError(
  sql: Sql,
  venue: string,
  connectionId: string,
  detail: string,
): Promise<void> {
  await sql`
    UPDATE pos_connections SET status = 'error', last_error = ${detail.slice(0, 500)},
                               updated_at = now()
    WHERE id = ${connectionId} AND venue_id = ${venue}`;
}

export async function disableConnection(
  sql: Sql,
  venue: string,
  connectionId: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE pos_connections SET status = 'disabled', updated_at = now()
    WHERE id = ${connectionId} AND venue_id = ${venue}
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Build the per-call context. Returns null when the operator has not supplied
 * the connector's secrets — the caller then reports `not_configured` rather than
 * attempting a call that cannot succeed.
 */
export function contextFor(
  connection: PosConnectionRow,
  env: unknown,
): PosContext | null {
  const credentials = credentialsFor(connection.provider, env);
  if (!credentials) return null;
  return {
    venue: connection.venue,
    connectionId: connection.id,
    externalLocationId: connection.externalLocationId,
    config: connection.config,
    credentials,
  };
}

/**
 * Persist one pulled check. The POS's bill id is the identity, so re-pulling
 * updates in place; lines are replaced wholesale because a POS check's lines are
 * only ever authoritative as a set (a removed line must disappear, not linger).
 */
export async function saveCheck(
  sql: Sql,
  venue: string,
  connectionId: string,
  check: PosCheck,
): Promise<string> {
  const [row] = await sql`
    INSERT INTO pos_checks (
      venue_id, connection_id, pos_bill_id, pos_check_number, pos_table_ref,
      table_id, pos_server_id, pos_server_name, revenue_centre, service, covers,
      currency, subtotal_minor, tax_minor, service_charge_minor, discount_minor,
      total_minor, paid_minor, opened_at, closed_at, raw, fetched_at)
    VALUES (
      ${venue}, ${connectionId}, ${check.posBillId}, ${check.posCheckNumber},
      ${check.posTableRef},
      (SELECT id FROM dining_tables
        WHERE venue_id = ${venue} AND pos_table_ref = ${check.posTableRef} LIMIT 1),
      ${check.posServerId}, ${check.posServerName}, ${check.revenueCentre},
      ${check.service}, ${check.covers}, ${check.currency}, ${check.subtotalMinor},
      ${check.taxMinor}, ${check.serviceChargeMinor}, ${check.discountMinor},
      ${check.totalMinor}, ${check.paidMinor}, ${check.openedAt}, ${check.closedAt},
      ${JSON.stringify(check.raw)}::jsonb, now())
    ON CONFLICT (venue_id, pos_bill_id) DO UPDATE SET
      pos_check_number     = EXCLUDED.pos_check_number,
      pos_table_ref        = EXCLUDED.pos_table_ref,
      table_id             = EXCLUDED.table_id,
      pos_server_id        = EXCLUDED.pos_server_id,
      pos_server_name      = EXCLUDED.pos_server_name,
      revenue_centre       = EXCLUDED.revenue_centre,
      service              = EXCLUDED.service,
      covers               = EXCLUDED.covers,
      subtotal_minor       = EXCLUDED.subtotal_minor,
      tax_minor            = EXCLUDED.tax_minor,
      service_charge_minor = EXCLUDED.service_charge_minor,
      discount_minor       = EXCLUDED.discount_minor,
      total_minor          = EXCLUDED.total_minor,
      paid_minor           = EXCLUDED.paid_minor,
      closed_at            = EXCLUDED.closed_at,
      raw                  = EXCLUDED.raw,
      fetched_at           = now(),
      updated_at           = now()
    RETURNING id`;
  const checkId = String(row.id);

  await sql`DELETE FROM pos_check_lines WHERE venue_id = ${venue} AND check_id = ${checkId}`;
  if (check.lines.length > 0) {
    // One multi-row insert, not one round trip per line.
    await sql`
      INSERT INTO pos_check_lines ${sql(
        check.lines.map((line, index) => ({
          venue_id: venue,
          check_id: checkId,
          pos_line_id: line.posLineId,
          pos_item_id: line.posItemId,
          name: line.name,
          category: line.category,
          qty: line.qty,
          unit_price_minor: line.unitPriceMinor,
          total_minor: line.totalMinor,
          modifiers: JSON.stringify(line.modifiers),
          voided: line.voided,
          display_order: index,
        })),
      )}
      ON CONFLICT (venue_id, check_id, pos_line_id) DO NOTHING`;
  }
  return checkId;
}

export type SyncOutcome =
  | { ok: true; pulled: number; saved: number }
  | { ok: false; error: string; detail?: string };

/**
 * Pull every open check for a venue and persist it. Safe to run as often as the
 * connector's freshness allows: the bill id is the key, so a repeat pull updates
 * rather than duplicates.
 */
export async function syncOpenChecks(
  sql: Sql,
  env: unknown,
  venue: string,
): Promise<SyncOutcome> {
  const connection = await getConnection(sql, venue);
  if (!connection) return { ok: false, error: "not_connected" };
  if (connection.status !== "connected") {
    return { ok: false, error: "not_verified" };
  }
  const connector = connectorFor(connection.provider, env);
  if (!connector) return { ok: false, error: "not_implemented" };
  if (!connector.capabilities.has("check.pull")) {
    return { ok: false, error: "unsupported" };
  }
  const ctx = contextFor(connection, env);
  if (!ctx) return { ok: false, error: "not_configured" };

  const result: PosResult<PosCheck[]> = await connector.listOpenChecks(ctx);
  if (!result.ok) {
    await markConnectionError(sql, venue, connection.id, result.detail ?? result.error);
    return { ok: false, error: result.error, detail: result.detail };
  }
  let saved = 0;
  for (const check of result.data) {
    await saveCheck(sql, venue, connection.id, check);
    saved += 1;
  }
  await sql`
    UPDATE pos_connections SET last_sync_at = now(), last_error = NULL, updated_at = now()
    WHERE id = ${connection.id} AND venue_id = ${venue}`;
  return { ok: true, pulled: result.data.length, saved };
}

export type StoredCheck = {
  id: string;
  posBillId: string;
  posCheckNumber: string | null;
  tableId: string | null;
  posTableRef: string | null;
  serverName: string | null;
  revenueCentre: string | null;
  covers: number | null;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  openedAt: string | null;
  closedAt: string | null;
  fetchedAt: string;
  lines: Array<{
    name: string;
    qty: number;
    unitPriceMinor: number;
    totalMinor: number;
    modifiers: Array<{ name: string; priceMinor: number }>;
    voided: boolean;
  }>;
};

type CheckRow = Record<string, unknown>;
type LineRow = Record<string, unknown>;

function toStoredCheck(row: CheckRow, lines: LineRow[]): StoredCheck {
  const totalMinor = Number(row.total_minor) || 0;
  const paidMinor = Number(row.paid_minor) || 0;
  return {
    id: String(row.id),
    posBillId: String(row.pos_bill_id),
    posCheckNumber: (row.pos_check_number as string | null) ?? null,
    tableId: (row.table_id as string | null) ?? null,
    posTableRef: (row.pos_table_ref as string | null) ?? null,
    serverName: (row.pos_server_name as string | null) ?? null,
    revenueCentre: (row.revenue_centre as string | null) ?? null,
    covers: row.covers === null ? null : Number(row.covers),
    currency: String(row.currency ?? "KES"),
    subtotalMinor: Number(row.subtotal_minor) || 0,
    taxMinor: Number(row.tax_minor) || 0,
    serviceChargeMinor: Number(row.service_charge_minor) || 0,
    discountMinor: Number(row.discount_minor) || 0,
    totalMinor,
    paidMinor,
    outstandingMinor: Math.max(0, totalMinor - paidMinor),
    openedAt: row.opened_at ? new Date(row.opened_at as string).toISOString() : null,
    closedAt: row.closed_at ? new Date(row.closed_at as string).toISOString() : null,
    fetchedAt: new Date(row.fetched_at as string).toISOString(),
    lines: lines.map((line) => ({
      name: String(line.name),
      qty: Number(line.qty) || 1,
      unitPriceMinor: Number(line.unit_price_minor) || 0,
      totalMinor: Number(line.total_minor) || 0,
      modifiers: ((line.modifiers as Array<{ name: string; priceMinor: number }>) ?? []),
      voided: Boolean(line.voided),
    })),
  };
}

const CHECK_COLUMNS = `id, pos_bill_id, pos_check_number, table_id, pos_table_ref,
       pos_server_name, revenue_centre, covers, currency, subtotal_minor,
       tax_minor, service_charge_minor, discount_minor, total_minor,
       paid_minor, opened_at, closed_at, fetched_at`;

export async function readCheck(
  sql: Sql,
  venue: string,
  checkId: string,
): Promise<StoredCheck | null> {
  const [row] = await sql`
    SELECT ${sql.unsafe(CHECK_COLUMNS)}
    FROM pos_checks
    WHERE venue_id = ${venue} AND id = ${checkId}
    LIMIT 1`;
  if (!row) return null;
  const lines = await sql`
    SELECT name, qty, unit_price_minor, total_minor, modifiers, voided
    FROM pos_check_lines
    WHERE venue_id = ${venue} AND check_id = ${checkId}
    ORDER BY display_order, name`;
  return toStoredCheck(row, lines as unknown as LineRow[]);
}

/**
 * Two queries for any number of checks, not two per check. The previous
 * implementation called `readCheck` in a loop, which meant 400 round trips for a
 * 200-check floor.
 */
export async function listOpenChecks(
  sql: Sql,
  venue: string,
): Promise<StoredCheck[]> {
  const rows = await sql`
    SELECT ${sql.unsafe(CHECK_COLUMNS)}
    FROM pos_checks
    WHERE venue_id = ${venue} AND closed_at IS NULL
    ORDER BY opened_at DESC NULLS LAST
    LIMIT 200`;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => String(row.id));
  const lines = await sql`
    SELECT check_id, name, qty, unit_price_minor, total_minor, modifiers, voided
    FROM pos_check_lines
    WHERE venue_id = ${venue} AND check_id = ANY(${ids}::uuid[])
    ORDER BY display_order, name`;
  const byCheck = new Map<string, LineRow[]>();
  for (const line of lines) {
    const key = String(line.check_id);
    const list = byCheck.get(key) ?? [];
    list.push(line);
    byCheck.set(key, list);
  }
  return rows.map((row) => toStoredCheck(row, byCheck.get(String(row.id)) ?? []));
}
