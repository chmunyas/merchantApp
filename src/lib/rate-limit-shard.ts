// Pure helpers for the sharded rate limiter. No I/O, so the sharding and window
// arithmetic that decides whether a real user gets a 429 can be tested directly.

/**
 * Fixed shard count. Changing it re-homes every key, which resets counters for
 * one window — acceptable on deploy, but it means this is a constant and not a
 * tunable knob to twiddle under load.
 */
export const RATE_LIMIT_SHARDS = 64;

/**
 * FNV-1a. Chosen over anything cryptographic because this only needs to spread
 * keys evenly and run on every request; a hash collision merely puts two keys on
 * one shard, which is harmless — each key still keeps its own counter.
 */
export function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function shardFor(key: string, shards = RATE_LIMIT_SHARDS): string {
  return `rl-${hashKey(key) % shards}`;
}

/** Milliseconds until the current fixed window closes. */
export function retryAfterSeconds(
  now: number,
  windowSeconds: number,
): number {
  const windowMs = Math.max(1, windowSeconds) * 1000;
  const resetAt = (Math.floor(now / windowMs) + 1) * windowMs;
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/** The bucket a key falls into for the window containing `now`. */
export function bucketFor(
  key: string,
  windowSeconds: number,
  now: number,
): string {
  const windowId = Math.floor(now / (Math.max(1, windowSeconds) * 1000));
  return `${key}:${windowId}`;
}
