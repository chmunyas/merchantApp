import { useCallback, useEffect, useRef, useState } from "react";

import {
  browserQueueStore,
  enqueueCharge,
  listQueued,
  queueStats,
  removeQueued,
  retryNow,
  syncQueue,
  type QueuedCharge,
  type QueueStats,
} from "@/lib/offline-queue";

// A single shared outbox for the whole app. Components coordinate through a
// custom event so the POS, the header pill and the sync cockpit always show the
// same queue without prop-drilling.
const CHANGED_EVENT = "pesaswap:offline-changed";
const store = browserQueueStore();

function emitChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

// Replay a queued sale by re-creating the payment with its STABLE idempotency
// key, so a duplicate submit (or a lost 200 after the server already recorded
// it) is de-duplicated server-side rather than double-charging.
async function sendCharge(c: QueuedCharge) {
  try {
    const description =
      typeof (c.metadata as { description?: unknown })?.description === "string"
        ? ((c.metadata as { description: string }).description)
        : "Offline sale (synced)";
    const res = await fetch("/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": c.idempotencyKey ?? c.id,
      },
      body: JSON.stringify({
        amount: c.amount,
        currency: c.currency,
        description,
        metadata: c.metadata,
      }),
    });
    if (!res.ok) return { ok: false, error: `server ${res.status}` };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network error",
    };
  }
}

// Store-and-forward for the POS: queue a sale locally when offline (or when a
// create fails on a flaky network) and replay it automatically when connectivity
// returns. Exposes live status for the sync cockpit.
export function useOfflineQueue() {
  const [online, setOnline] = useState(isOnline);
  const [items, setItems] = useState<QueuedCharge[]>(() => listQueued(store));
  const [stats, setStats] = useState<QueueStats>(() => queueStats(store));
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refresh = useCallback(() => {
    setItems(listQueued(store));
    setStats(queueStats(store));
  }, []);

  const flush = useCallback(async () => {
    if (syncingRef.current || !isOnline() || queueStats(store).total === 0) {
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const res = await syncQueue(store, sendCharge);
      refresh();
      if (res.sent > 0) emitChanged();
      return res;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refresh]);

  const enqueue = useCallback(
    (charge: Parameters<typeof enqueueCharge>[1]) => {
      const entry = enqueueCharge(store, charge);
      refresh();
      emitChanged();
      if (isOnline()) void flush();
      return entry;
    },
    [refresh, flush],
  );

  const remove = useCallback(
    (id: string) => {
      removeQueued(store, id);
      refresh();
      emitChanged();
    },
    [refresh],
  );

  const retry = useCallback(
    (id: string) => {
      retryNow(store, id);
      refresh();
      void flush();
    },
    [refresh, flush],
  );

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(CHANGED_EVENT, refresh);
    // Periodic retry: connectivity can return without the 'online' event firing
    // (some browsers / PWAs), and backed-off items become due over time.
    const interval = window.setInterval(() => {
      setOnline(isOnline());
      if (isOnline() && queueStats(store).total > 0) void flush();
    }, 15_000);
    if (isOnline()) void flush();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(CHANGED_EVENT, refresh);
      window.clearInterval(interval);
    };
  }, [flush, refresh]);

  return { online, items, stats, syncing, flush, enqueue, remove, retry };
}
