import { authFetch, hasAuthoritativeVenueSession } from "@/lib/auth";
import { getCurrentVenueId, isDemoVenue } from "@/lib/tenant-store";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readStorage<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

let suppressSync = false;
const revisions = new Map<string, number>();
const dirty = new Set<string>();

function revisionKey(venue: string, key: string): string {
  return `${venue}\0${key}`;
}

export function isOnlineForMutation(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function mirroredKey(key: string): boolean {
  return (
    (key.startsWith("fxengine.") || key.startsWith("pesaswap.services.")) &&
    !key.endsWith("schemaVersion") &&
    !key.endsWith("currentVenue")
  );
}

export function writeStorage<T>(key: string, value: T): void {
  if (!canUseStorage()) return;
  const mirrored = mirroredKey(key);
  const venue = getCurrentVenueId();
  const shouldSync =
    !suppressSync &&
    mirrored &&
    !isDemoVenue(venue) &&
    hasAuthoritativeVenueSession();
  if (shouldSync) {
    if (!isOnlineForMutation()) {
      window.dispatchEvent(new CustomEvent("pesaswap:state-write-blocked", { detail: { key } }));
      return;
    }
    dirty.add(revisionKey(venue, key));
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.warn("[storage] quota exceeded for key:", key);
  }
  if (shouldSync) void pushState(key, value);
}

// Writes to the same key are chained: the revision is only known once the
// previous response lands, so firing two in parallel makes the tab conflict
// with itself and tell the merchant the data "changed on another device".
const inflight = new Map<string, Promise<void>>();

function pushState(key: string, value: unknown): Promise<void> {
  const venue = getCurrentVenueId();
  const marker = revisionKey(venue, key);
  const run = () => sendState(key, value, venue, marker);
  const chained = (inflight.get(marker) ?? Promise.resolve()).then(run, run);
  inflight.set(marker, chained);
  void chained.finally(() => {
    if (inflight.get(marker) === chained) inflight.delete(marker);
  });
  return chained;
}

async function sendState(
  key: string,
  value: unknown,
  venue: string,
  marker: string,
): Promise<void> {
  try {
    const response = await authFetch(`/api/state?venue=${encodeURIComponent(venue)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value, revision: revisions.get(marker) ?? 0 }),
      keepalive: true,
    });
    const data = await response.json().catch(() => ({})) as {
      revision?: number;
      current?: { value: unknown; revision: number } | null;
    };
    if (response.status === 409) {
      dirty.delete(marker);
      if (data.current) revisions.set(marker, data.current.revision);
      window.dispatchEvent(new CustomEvent("pesaswap:state-conflict", {
        detail: { key, localValue: value, current: data.current },
      }));
      return;
    }
    if (!response.ok || !Number.isInteger(data.revision)) {
      throw new Error(`state write failed: ${response.status}`);
    }
    revisions.set(marker, Number(data.revision));
    dirty.delete(marker);
  } catch {
    dirty.delete(marker);
    window.dispatchEvent(new CustomEvent("pesaswap:state-write-failed", { detail: { key } }));
  }
}

function seedState(): void {
  if (!canUseStorage()) return;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith("fxengine.") || !mirroredKey(key)) continue;
    try {
      void pushState(key, JSON.parse(window.localStorage.getItem(key) ?? "null"));
    } catch {
      // Skip malformed legacy entries.
    }
  }
}

export async function hydrateMerchantState(): Promise<void> {
  if (!canUseStorage() || typeof fetch === "undefined") return;
  try {
    const venue = getCurrentVenueId();
    const response = await authFetch(`/api/state?venue=${encodeURIComponent(venue)}`);
    if (!response.ok) return;
    const data = await response.json() as {
      state?: Record<string, { value: unknown; revision: number; updatedAt: string }>;
    };
    const state = data.state ?? {};
    const keys = Object.keys(state);
    if (keys.length === 0) {
      seedState();
      return;
    }
    suppressSync = true;
    try {
      for (const key of keys) {
        const marker = revisionKey(venue, key);
        revisions.set(marker, Number(state[key].revision));
        if (!dirty.has(marker)) writeStorage(key, state[key].value);
      }
    } finally {
      suppressSync = false;
    }
    window.dispatchEvent(new Event("pesaswap:state-hydrated"));
  } catch {
    // Cached state remains read-only while offline.
  }
}
