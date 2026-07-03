import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

// In Cloudflare production this is a Hyperdrive binding; in Node dev it is a
// DATABASE_URL. Either way the database itself is always PostgreSQL.
export type BackendEnv = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
};

let cached: Sql | null = null;

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

// Lazily create a pooled connection. Never called at module top-level scope
// (Cloudflare Workers forbid I/O there).
export function getSql(env?: unknown): Sql | null {
  if (cached) return cached;
  const connection = resolveConnectionString(env);
  if (!connection) return null;
  cached = postgres(connection, {
    max: 5,
    idle_timeout: 20,
    prepare: false, // pooler / Hyperdrive friendly
  });
  return cached;
}

export function hasDatabase(env?: unknown): boolean {
  return resolveConnectionString(env) !== null;
}

// Workers AI is used when the binding is present; callers must handle null.
export function getAi(env?: unknown): BackendEnv["AI"] | null {
  return (env as BackendEnv | undefined)?.AI ?? null;
}
