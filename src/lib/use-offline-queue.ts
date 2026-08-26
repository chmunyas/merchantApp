import { useCallback, useEffect, useState } from "react";

import {
  browserQueueStore,
  enqueueCharge,
  listQueued,
  queueStats,
  removeQueued,
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

// Offline payment entries are drafts. Reconnection never auto-submits money;
// an operator must review and start a fresh online intent.
export function useOfflineQueue() {
  const [online, setOnline] = useState(isOnline);
  const [items, setItems] = useState<QueuedCharge[]>(() => listQueued(store));
  const [stats, setStats] = useState<QueueStats>(() => queueStats(store));

  const refresh = useCallback(() => {
    setItems(listQueued(store));
    setStats(queueStats(store));
  }, []);

  const flush = useCallback(async () => {
    refresh();
    return { sent: 0, failed: 0, remaining: queueStats(store).total, skipped: 0 };
  }, [refresh]);

  const enqueue = useCallback(
    (charge: Parameters<typeof enqueueCharge>[1]) => {
      const entry = enqueueCharge(store, charge);
      refresh();
      emitChanged();
      return entry;
    },
    [refresh],
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
    (_id: string) => {
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(CHANGED_EVENT, refresh);
    };
  }, [flush, refresh]);

  return { online, items, stats, syncing: false, flush, enqueue, remove, retry };
}
