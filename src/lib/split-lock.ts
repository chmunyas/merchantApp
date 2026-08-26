import type { Sql } from "@/lib/db";
import { apportionBill, type BillLine } from "@/lib/split-apportion";

// How long a granted share stays reserved. Long enough to cover an M-Pesa STK
// approval on the guest's handset (the payment sits in `processing` and is not
// yet counted as paid), short enough that an abandoned checkout frees the share
// again without anyone intervening.
export const HOLD_TTL_SECONDS = 120;

// A2.2 item claims live a little longer than a bare amount hold: the guest has
// already picked their dishes and still has to key in a phone number before the
// STK prompt starts. Same self-healing discipline, just a longer fuse.
export const ITEM_CLAIM_TTL_SECONDS = 300;

const SUCCEEDED_STATUSES = ["succeeded", "paid", "captured"] as const;

export type HoldRequest = {
  orderId: string;
  venue: string;
  /** Stable per-attempt key (the request's Idempotency-Key). */
  holdKey: string;
  /** Order portion requested in minor units. The tip is NOT part of this. */
  requestedMinor: number;
  ttlSeconds?: number;
};

export type HoldResult = {
  /** Order portion the caller may charge, in minor units. */
  grantedMinor: number;
  /** Outstanding balance seen at grant time, in minor units. */
  remainingMinor: number;
  /**
   * True when the grant was serialised on the order row. False means the
   * database refused a transaction and we fell back to an unsynchronised
   * read-clamp — correct for a single payer, best-effort under a race.
   */
  serialised: boolean;
};

/**
 * Reserve a share of an order's outstanding balance.
 *
 * Returns `null` when the order does not exist, so the caller can fall through
 * to an unconstrained charge (pay links, invoices and Tap&Go carry no order).
 *
 * The tip is deliberately excluded: a tip rides on top of the bill and a guest
 * may leave one even on a fully settled check.
 */
export async function holdOrderShare(
  sql: Sql,
  req: HoldRequest,
): Promise<HoldResult | null> {
  const requested = Math.max(0, Math.round(req.requestedMinor));
  const ttl = Math.max(1, Math.round(req.ttlSeconds ?? HOLD_TTL_SECONDS));

  try {
    const result = await sql.begin(async (tx) => {
      // Serialise every concurrent grant for this bill behind the order row.
      const [order] = await tx`
        SELECT total::bigint AS total
        FROM orders
        WHERE id = ${req.orderId} AND venue_id = ${req.venue}
        FOR UPDATE`;
      if (!order) return null;

      // Housekeeping + let a retry re-compete for its own previously held share.
      await tx`
        DELETE FROM payment_holds
        WHERE order_id = ${req.orderId}
          AND (hold_key = ${req.holdKey} OR expires_at <= now())`;

      const [sums] = await tx`
        SELECT
          order_paid_minor(${req.venue}, ${req.orderId}::uuid) AS paid,
          COALESCE((SELECT sum(h.amount)
                    FROM payment_holds h
                    WHERE h.order_id = ${req.orderId}
                      AND h.expires_at > now()), 0)::bigint AS held`;

      const remaining = Math.max(
        0,
        Number(order.total) - Number(sums?.paid ?? 0) - Number(sums?.held ?? 0),
      );
      const granted = Math.min(requested, remaining);

      if (granted > 0) {
        await tx`
          INSERT INTO payment_holds (venue_id, order_id, hold_key, amount, expires_at)
          VALUES (${req.venue}, ${req.orderId}, ${req.holdKey}, ${granted},
                  now() + make_interval(secs => ${ttl}))
          ON CONFLICT (order_id, hold_key)
          DO UPDATE SET amount = EXCLUDED.amount, expires_at = EXCLUDED.expires_at`;
      }

      return { grantedMinor: granted, remainingMinor: remaining, serialised: true };
    });
    return (result ?? null) as HoldResult | null;
  } catch {
    // No transaction support (or a transient failure): never make the guard
    // weaker than an unguarded charge — fall back to the read-clamp.
    return await clampWithoutLock(sql, req.venue, req.orderId, requested);
  }
}

/**
 * Free a share that will never be charged (a decline, an abandoned intent).
 * Best-effort: the hold expires on its own regardless.
 */
export async function releaseOrderShare(
  sql: Sql,
  orderId: string,
  holdKey: string,
): Promise<void> {
  try {
    await sql`
      DELETE FROM payment_holds
      WHERE order_id = ${orderId} AND hold_key = ${holdKey}`;
  } catch {
    /* the TTL is the backstop */
  }
}

async function clampWithoutLock(
  sql: Sql,
  venue: string,
  orderId: string,
  requestedMinor: number,
): Promise<HoldResult | null> {
  try {
    const [row] = await sql`
      SELECT o.total::bigint AS total,
             order_paid_minor(${venue}, ${orderId}::uuid) AS paid
      FROM orders o WHERE o.id = ${orderId} AND o.venue_id = ${venue} LIMIT 1`;
    if (!row) return null;
    const remaining = Math.max(0, Number(row.total) - Number(row.paid));
    return {
      grantedMinor: Math.min(requestedMinor, remaining),
      remainingMinor: remaining,
      serialised: false,
    };
  } catch {
    return null;
  }
}

// --- A2.2 split by item -----------------------------------------------------

export type ItemClaimRequest = {
  orderId: string;
  venue: string;
  /** Stable per-guest key. Also becomes the payment's hold key. */
  claimKey: string;
  /** `order_items.id` values the guest is taking responsibility for. */
  itemIds: readonly string[];
  ttlSeconds?: number;
};

export type ItemClaimResult = {
  /** Lines this guest now holds. */
  claimedItemIds: string[];
  /** Lines refused — already held or already paid by someone else. */
  conflictItemIds: string[];
  /** Apportioned worth of the claimed lines, in minor units. */
  itemsMinor: number;
  /**
   * What may actually be charged. Normally equal to `itemsMinor`; lower when
   * someone paid an unallocated amount (an even split or a custom amount) that
   * already covered part of these dishes. Never exceeds the outstanding balance,
   * so A2.5 still holds across all three split modes.
   */
  grantedMinor: number;
  remainingMinor: number;
  serialised: boolean;
};

export type ItemClaimRow = {
  orderItemId: string;
  claimKey: string;
  amountMinor: number;
  status: "held" | "paid";
};

/**
 * Promote held claims whose payment has since succeeded, then drop claims that
 * expired without ever being paid. Idempotent; safe to call on any read path.
 *
 * The promotion is what makes a PAID dish permanently unclaimable: the claim row
 * stops expiring the moment its payment lands, so no later guest can select it.
 */
async function reconcileItemClaims(db: Sql, orderId: string): Promise<void> {
  await db`
    UPDATE order_item_claims c
    SET status = 'paid',
        payment_id = p.id,
        updated_at = now()
    FROM payments p
    WHERE c.order_id = ${orderId}
      AND c.status = 'held'
      AND p.metadata->>'item_claim_key' = c.claim_key
      AND p.status = ANY(${SUCCEEDED_STATUSES as unknown as string[]})
      AND p.kind <> 'refund'`;
  await db`
    DELETE FROM order_item_claims
    WHERE order_id = ${orderId}
      AND status = 'held'
      AND expires_at <= now()`;
}

/** Live claim state for a bill, after reconciliation. */
export async function listItemClaims(
  sql: Sql,
  orderId: string,
): Promise<ItemClaimRow[]> {
  try {
    await reconcileItemClaims(sql, orderId);
  } catch {
    /* reading the bill must never fail because housekeeping did */
  }
  try {
    const rows = await sql`
      SELECT order_item_id, claim_key, amount::bigint AS amount, status
      FROM order_item_claims
      WHERE order_id = ${orderId}
      ORDER BY created_at`;
    return rows.map((row) => ({
      orderItemId: String(row.order_item_id),
      claimKey: String(row.claim_key),
      amountMinor: Number(row.amount) || 0,
      status: String(row.status) === "paid" ? "paid" : "held",
    }));
  } catch {
    return [];
  }
}

async function runItemClaim(
  db: Sql,
  req: ItemClaimRequest,
  ttl: number,
  serialised: boolean,
): Promise<ItemClaimResult | null> {
  const [order] = serialised
    ? await db`
        SELECT total::bigint AS total
        FROM orders
        WHERE id = ${req.orderId}
        FOR UPDATE`
    : await db`
        SELECT total::bigint AS total
        FROM orders
        WHERE id = ${req.orderId}
        LIMIT 1`;
  if (!order) return null;

  await reconcileItemClaims(db, req.orderId);
  // Let a retry re-compete for its OWN reservation instead of colliding with it.
  await db`
    DELETE FROM order_item_claims
    WHERE order_id = ${req.orderId}
      AND status = 'held'
      AND claim_key = ${req.claimKey}`;
  await db`
    DELETE FROM payment_holds
    WHERE order_id = ${req.orderId}
      AND (hold_key = ${req.claimKey} OR expires_at <= now())`;

  const lineRows = await db`
    SELECT id, qty, price::bigint AS price
    FROM order_items
    WHERE order_id = ${req.orderId}
    ORDER BY id`;
  const lines: BillLine[] = lineRows.map((row) => ({
    id: String(row.id),
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
  }));
  const apportioned = apportionBill(lines, Number(order.total) || 0);

  const requested = [...new Set(req.itemIds.map((id) => String(id)))];
  const claimedItemIds: string[] = [];
  const conflictItemIds: string[] = [];
  for (const itemId of requested) {
    const amount = apportioned.get(itemId);
    if (amount === undefined) {
      // Not a line on this bill: refuse rather than silently drop it.
      conflictItemIds.push(itemId);
      continue;
    }
    // The unique index on order_item_id is the actual race guard — the read
    // above only shortens the odds.
    const inserted = await db`
      INSERT INTO order_item_claims
        (venue_id, order_id, order_item_id, claim_key, amount, status, expires_at)
      VALUES (${req.venue}, ${req.orderId}, ${itemId}, ${req.claimKey}, ${amount},
              'held', now() + make_interval(secs => ${ttl}))
      ON CONFLICT (order_item_id) DO NOTHING
      RETURNING order_item_id`;
    if (inserted.length > 0) claimedItemIds.push(itemId);
    else conflictItemIds.push(itemId);
  }

  const itemsMinor = claimedItemIds.reduce(
    (sum, id) => sum + (apportioned.get(id) ?? 0),
    0,
  );

  const [sums] = await db`
    SELECT
      order_paid_minor(${req.venue}, ${req.orderId}::uuid) AS paid,
      COALESCE((SELECT sum(h.amount)
                FROM payment_holds h
                WHERE h.order_id = ${req.orderId}
                  AND h.expires_at > now()), 0)::bigint AS held`;
  const remaining = Math.max(
    0,
    Number(order.total) - Number(sums?.paid ?? 0) - Number(sums?.held ?? 0),
  );
  const granted = Math.min(itemsMinor, remaining);

  if (granted <= 0) {
    // Nothing chargeable: hand the dishes straight back rather than parking
    // them behind a five-minute expiry for no reason.
    await db`
      DELETE FROM order_item_claims
      WHERE order_id = ${req.orderId}
        AND status = 'held'
        AND claim_key = ${req.claimKey}`;
    return {
      claimedItemIds: [],
      conflictItemIds: [...conflictItemIds, ...claimedItemIds],
      itemsMinor,
      grantedMinor: 0,
      remainingMinor: remaining,
      serialised,
    };
  }

  await db`
    INSERT INTO payment_holds (venue_id, order_id, hold_key, amount, expires_at)
    VALUES (${req.venue}, ${req.orderId}, ${req.claimKey}, ${granted},
            now() + make_interval(secs => ${ttl}))
    ON CONFLICT (order_id, hold_key)
    DO UPDATE SET amount = EXCLUDED.amount, expires_at = EXCLUDED.expires_at`;

  return {
    claimedItemIds,
    conflictItemIds,
    itemsMinor,
    grantedMinor: granted,
    remainingMinor: remaining,
    serialised,
  };
}

/**
 * Reserve specific bill lines for one guest and hold the money they are worth.
 *
 * Returns `null` when the order does not exist. A line already held or paid by
 * someone else comes back in `conflictItemIds` and is NOT charged.
 *
 * The reservation is taken under the same per-order lock as `holdOrderShare`,
 * and lands a `payment_holds` row keyed by the same `claimKey`, so the even
 * split, the custom amount and the by-item path all compete for one balance.
 */
export async function claimOrderItems(
  sql: Sql,
  req: ItemClaimRequest,
): Promise<ItemClaimResult | null> {
  const ttl = Math.max(1, Math.round(req.ttlSeconds ?? ITEM_CLAIM_TTL_SECONDS));
  try {
    const result = await sql.begin(async (tx) =>
      runItemClaim(tx as unknown as Sql, req, ttl, true),
    );
    return (result ?? null) as ItemClaimResult | null;
  } catch {
    // No transaction support (or a transient failure). The unique index still
    // prevents a double claim; only the amount clamp loses its serialisation.
    try {
      return await runItemClaim(sql, req, ttl, false);
    } catch {
      return null;
    }
  }
}

/**
 * Hand back dishes that will never be paid for (a decline, a cancelled
 * checkout). Only ever releases HELD claims — a paid line stays paid.
 * Best-effort: the expiry is the backstop.
 */
export async function releaseOrderItemClaims(
  sql: Sql,
  orderId: string,
  claimKey: string,
): Promise<void> {
  try {
    await sql`
      DELETE FROM order_item_claims
      WHERE order_id = ${orderId}
        AND claim_key = ${claimKey}
        AND status = 'held'`;
  } catch {
    /* the TTL is the backstop */
  }
  await releaseOrderShare(sql, orderId, claimKey);
}
