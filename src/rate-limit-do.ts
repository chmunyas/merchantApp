// Fixed-window rate limiting as a Durable Object.
//
// Why this replaces the Postgres counter: the old implementation took an
// `INSERT … ON CONFLICT` on `rate_limits` for EVERY rate-limited request, plus a
// full `DELETE … WHERE expires_at < now()` on ~2% of calls. That is a write to
// the primary database on the hottest path in the system, and it scales in
// exactly the wrong direction — the busier the platform, the more write pressure
// the abuse protection itself generates.
//
// Design notes that matter:
//
//  * **Sharded, not one-DO-per-key.** A DO per (route, IP) would be correct but
//    unbounded: millions of instances, each with creation and eviction cost. We
//    hash the key into a fixed number of shards instead, so cost is bounded and
//    predictable while each individual key still has exactly one authoritative
//    counter (a key always lands on the same shard).
//
//  * **Counters live in memory, not DO storage.** A storage write per request
//    would reintroduce the problem we are solving. A DO is single-threaded and
//    globally addressable, so an in-memory Map is already consistent for every
//    caller of that shard.
//
//  * **Eviction fails OPEN.** If the runtime evicts a shard, its counters reset
//    and some requests get a fresh window. That matches the existing contract —
//    the Postgres limiter also failed open when the database was unreachable —
//    and it is the right trade for a limiter: never lock legitimate users out of
//    a payment flow because infrastructure blinked.

type Counter = { count: number; resetAt: number };

/** Bounded so an eviction-free shard cannot grow without limit. */
const MAX_KEYS_PER_SHARD = 50_000;

export class RateLimiterShard {
  private counters = new Map<string, Counter>();
  private lastSweep = 0;

  /** Drop expired counters. O(n) but amortised: at most once per second. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 1000) return;
    this.lastSweep = now;
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) this.counters.delete(key);
    }
    // Pathological cardinality (a spray of unique keys inside one window):
    // drop everything rather than grow unbounded. Failing open is the contract.
    if (this.counters.size > MAX_KEYS_PER_SHARD) this.counters.clear();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    let body: { key?: string; limit?: number; windowSeconds?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("bad request", { status: 400 });
    }
    const key = String(body.key ?? "");
    const limit = Math.max(1, Math.floor(Number(body.limit) || 1));
    const windowSeconds = Math.max(1, Math.floor(Number(body.windowSeconds) || 60));
    if (!key) return new Response("bad request", { status: 400 });

    const now = Date.now();
    this.sweep(now);

    const windowMs = windowSeconds * 1000;
    const resetAt = (Math.floor(now / windowMs) + 1) * windowMs;
    const existing = this.counters.get(key);
    const counter =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt };
    counter.count += 1;
    this.counters.set(key, counter);

    const limited = counter.count > limit;
    return Response.json({
      count: counter.count,
      limited,
      remaining: Math.max(0, limit - counter.count),
      retryAfter: limited
        ? Math.max(1, Math.ceil((counter.resetAt - now) / 1000))
        : 0,
    });
  }
}
