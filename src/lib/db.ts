import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;
export type TransactionSql = postgres.TransactionSql;
export type QuerySql = Sql | TransactionSql;

// In Cloudflare production this is a Hyperdrive binding; in Node dev it is a
// DATABASE_URL. Either way the database itself is always PostgreSQL.
export type BackendEnv = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
};

// On Cloudflare Workers an I/O object (socket) created in one request cannot be
// used in another. A module-cached client therefore breaks across requests. We
// scope a fresh client per request via AsyncLocalStorage (see withRequestSql)
// and only fall back to a long-lived module client in Node dev, where reuse is
// fine and avoids reconnecting on every call.
const requestSql = new AsyncLocalStorage<Sql>();
let devCached: Sql | null = null;

function resolveConnectionString(env?: unknown): string | null {
  const e = (env ?? {}) as BackendEnv;
  if (e.HYPERDRIVE?.connectionString) return e.HYPERDRIVE.connectionString;
  if (e.DATABASE_URL) return e.DATABASE_URL;
  if (
    typeof process !== "undefined" &&
    typeof process.env?.DATABASE_URL === "string"
  ) {
    return process.env.DATABASE_URL;
  }
  return null;
}

function makeClient(connection: string): Sql {
  return postgres(connection, {
    max: 5,
    idle_timeout: 20,
    prepare: false, // pooler / Hyperdrive friendly
  });
}

// Lazily obtain a Postgres client. Returns the per-request client when running
// inside withRequestSql (Workers), else a cached module client (Node dev).
export function getSql(env?: unknown): Sql | null {
  const scoped = requestSql.getStore();
  if (scoped) return scoped;
  if (devCached) return devCached;
  const connection = resolveConnectionString(env);
  if (!connection) return null;
  devCached = makeClient(connection);
  return devCached;
}

// Run `fn` with a fresh per-request Postgres client on the Workers/Hyperdrive
// path (closed after the response is flushed so sockets never cross requests).
// In Node dev there is no HYPERDRIVE binding, so it runs `fn` unscoped and
// getSql uses the module cache.
export async function withRequestSql<T>(
  env: unknown,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void } | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const e = (env ?? {}) as BackendEnv;
  const connection = e.HYPERDRIVE?.connectionString;
  if (!connection) return fn(); // Node dev / no Hyperdrive — module cache path.
  const sql = makeClient(connection);
  try {
    return await requestSql.run(sql, fn);
  } finally {
    // postgres.js is lazy: an unused client never connects, so end() is cheap.
    // Close after the response so it never blocks the request.
    const closing = sql.end({ timeout: 5 }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(closing);
    else await closing;
  }
}

export function hasDatabase(env?: unknown): boolean {
  return resolveConnectionString(env) !== null;
}

// Workers AI is used when the binding is present; callers must handle null.
export function getAi(env?: unknown): BackendEnv["AI"] | null {
  return (env as BackendEnv | undefined)?.AI ?? null;
}
