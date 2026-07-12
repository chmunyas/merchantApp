import { RefreshCw, Wifi, WifiOff, AlertTriangle, X, Clock3 } from "lucide-react";

import { useOfflineQueue } from "@/lib/use-offline-queue";
import type { QueuedCharge } from "@/lib/offline-queue";

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function money(minor: number): string {
  return `KES ${(minor / 100).toLocaleString()}`;
}

function itemStatus(c: QueuedCharge): { label: string; tone: string } {
  if (c.attempts > 0 && c.nextRetryAt && c.nextRetryAt > Date.now()) {
    const secs = Math.max(1, Math.round((c.nextRetryAt - Date.now()) / 1000));
    return {
      label: `Retry in ${secs}s${c.lastError ? ` · ${c.lastError}` : ""}`,
      tone: "text-amber-700 bg-amber-50 border-amber-200",
    };
  }
  return {
    label: "Pending sync",
    tone: "text-sky-700 bg-sky-50 border-sky-200",
  };
}

// The sync cockpit: clear, honest status for store-and-forward sales. It shows
// online/offline, how many sales are queued, and lets the merchant force a sync
// or retry/discard a stuck one. Renders nothing when online with an empty queue.
export function SyncCockpit() {
  const { online, items, stats, syncing, flush, remove, retry } =
    useOfflineQueue();

  if (online && stats.total === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {online ? (
            <Wifi className="size-4 text-emerald-600" />
          ) : (
            <WifiOff className="size-4 text-amber-600" />
          )}
          <div>
            <p className="text-sm font-bold leading-tight">
              {online ? "Sync status" : "Offline mode"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {stats.total === 0
                ? "All sales synced"
                : `${stats.total} sale${stats.total > 1 ? "s" : ""} queued`}
              {stats.failed > 0 ? ` · ${stats.failed} retrying` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void flush()}
          disabled={!online || syncing || stats.total === 0}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          <RefreshCw className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {!online && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 p-2.5">
          <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 leading-snug">
            You&apos;re offline. Sales are saved securely on this device and will
            sync automatically when you&apos;re back online. A queued sale isn&apos;t
            settled until it syncs.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items
            .slice()
            .reverse()
            .map((c) => {
              const st = itemStatus(c);
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold font-mono">
                      {money(c.amount)}
                    </p>
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock3 className="size-3" /> {relTime(c.queuedAt)}
                      {c.attempts > 0 ? ` · ${c.attempts} attempt(s)` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`hidden sm:inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.tone}`}
                    >
                      {st.label}
                    </span>
                    {c.attempts > 0 && online && (
                      <button
                        type="button"
                        onClick={() => retry(c.id)}
                        className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      aria-label="Discard queued sale"
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}

// A compact header pill: offline state + queued count. Tapping is handled by the
// parent (e.g. switch to the home tab where the full cockpit lives).
export function SyncStatusPill({ onClick }: { onClick?: () => void }) {
  const { online, stats } = useOfflineQueue();
  if (online && stats.total === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
        online
          ? "bg-sky-100 text-sky-700"
          : "bg-amber-100 text-amber-800"
      }`}
    >
      {online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
      {online
        ? `${stats.total} to sync`
        : stats.total > 0
          ? `Offline · ${stats.total}`
          : "Offline"}
    </button>
  );
}
