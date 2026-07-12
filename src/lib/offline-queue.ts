// A tiny offline outbox for the tap-and-go POS. On a flaky mobile network a
// charge CREATE can be queued and replayed when connectivity returns. Note:
// mobile-money CONFIRMATION (the customer's M-Pesa PIN) is inherently online —
// this queues the create/retry request only, never a fake "paid" state.
// Storage is injected so the queue is unit-testable without a browser.

export type QueuedCharge = {
  id: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
  // A stable key for safe, de-duplicated replay (sent as the Idempotency-Key
  // header). Defaults to the sale id when not provided.
  idempotencyKey?: string;
  // Last failure reason + a backoff gate, surfaced in the sync cockpit.
  lastError?: string;
  nextRetryAt?: number;
};

export interface QueueStore {
  get(): string | null;
  set(value: string): void;
}

// Keep the outbox bounded so a long offline stretch can't blow up storage.
const MAX = 100;
// Exponential backoff for a failing item: 5s, 10s, 20s … capped at 5 min.
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 5 * 60_000;

export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
}

function read(store: QueueStore): QueuedCharge[] {
  try {
    const raw = store.get();
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as QueuedCharge[]) : [];
  } catch {
    return [];
  }
}

function write(store: QueueStore, items: QueuedCharge[]): void {
  store.set(JSON.stringify(items.slice(-MAX)));
}

export function enqueueCharge(
  store: QueueStore,
  charge: Omit<QueuedCharge, "queuedAt" | "attempts">,
): QueuedCharge {
  const items = read(store);
  const entry: QueuedCharge = {
    ...charge,
    idempotencyKey: charge.idempotencyKey ?? charge.id,
    queuedAt: Date.now(),
    attempts: 0,
  };
  items.push(entry);
  write(store, items);
  return entry;
}

export function listQueued(store: QueueStore): QueuedCharge[] {
  return read(store);
}

export function queueSize(store: QueueStore): number {
  return read(store).length;
}

export function removeQueued(store: QueueStore, id: string): void {
  write(
    store,
    read(store).filter((c) => c.id !== id),
  );
}

// Clear a failed item's backoff so the next sync retries it immediately (the
// cockpit's "Retry" action).
export function retryNow(store: QueueStore, id: string): void {
  write(
    store,
    read(store).map((c) =>
      c.id === id ? { ...c, nextRetryAt: undefined, lastError: undefined } : c,
    ),
  );
}

export type QueueStats = {
  total: number;
  pending: number; // due to send now (never attempted, or backoff elapsed)
  failed: number; // attempted at least once and currently backing off
  oldestAt: number | null;
};

export function queueStats(store: QueueStore, now = Date.now()): QueueStats {
  const items = read(store);
  let pending = 0;
  let failed = 0;
  for (const c of items) {
    if (c.attempts > 0 && c.nextRetryAt && c.nextRetryAt > now) failed += 1;
    else pending += 1;
  }
  return {
    total: items.length,
    pending,
    failed,
    oldestAt: items.length ? Math.min(...items.map((c) => c.queuedAt)) : null,
  };
}

export type SyncResult = { ok: boolean; error?: string };

// Replay every DUE queued charge through `send`, in order. Successes are
// dropped; failures increment `attempts`, record `lastError` and are gated by an
// exponential backoff so a persistently failing item does not hammer the network
// or block the ones behind it. Items still inside their backoff window are
// skipped (not retried yet). Returns a summary for the cockpit.
export async function syncQueue(
  store: QueueStore,
  send: (c: QueuedCharge) => Promise<SyncResult>,
  now = Date.now(),
): Promise<{ sent: number; failed: number; remaining: number; skipped: number }> {
  const items = read(store);
  const keep: QueuedCharge[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const c of items) {
    // Respect the backoff window — leave it queued, retry on a later pass.
    if (c.attempts > 0 && c.nextRetryAt && c.nextRetryAt > now) {
      keep.push(c);
      skipped += 1;
      continue;
    }
    let result: SyncResult;
    try {
      result = await send(c);
    } catch (err) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : "sync failed",
      };
    }
    if (result.ok) {
      sent += 1;
    } else {
      const attempts = c.attempts + 1;
      keep.push({
        ...c,
        attempts,
        lastError: result.error ?? "sync failed",
        nextRetryAt: now + backoffMs(attempts),
      });
      failed += 1;
    }
  }
  write(store, keep);
  return { sent, failed, remaining: keep.length, skipped };
}

// Replay every queued charge through `send`; drop the ones that succeed, keep +
// increment `attempts` on the ones that still fail. Returns {sent, remaining}.
export async function drainQueue(
  store: QueueStore,
  send: (c: QueuedCharge) => Promise<boolean>,
): Promise<{ sent: number; remaining: number }> {
  const items = read(store);
  const keep: QueuedCharge[] = [];
  let sent = 0;
  for (const c of items) {
    let ok = false;
    try {
      ok = await send(c);
    } catch {
      ok = false;
    }
    if (ok) sent += 1;
    else keep.push({ ...c, attempts: c.attempts + 1 });
  }
  write(store, keep);
  return { sent, remaining: keep.length };
}

// Browser-backed store (localStorage); a no-op-safe store on the server.
export function browserQueueStore(key = "pesaswap.pos.outbox"): QueueStore {
  return {
    get: () =>
      typeof localStorage === "undefined" ? null : localStorage.getItem(key),
    set: (v) => {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, v);
    },
  };
}
