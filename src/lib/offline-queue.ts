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
};

export interface QueueStore {
  get(): string | null;
  set(value: string): void;
}

const MAX = 50;

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
  const entry: QueuedCharge = { ...charge, queuedAt: Date.now(), attempts: 0 };
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
