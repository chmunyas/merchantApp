import { getSql } from "@/lib/db";

const cache = new Map<string, { response: unknown; expires: number }>();
const TTL_MS = 3_600_000;
let lastCleanup = 0;

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < 600_000) return;
  lastCleanup = now;
  for (const [key, value] of cache) {
    if (value.expires < now) cache.delete(key);
  }
}

export async function reservePaymentIdempotency(
  env: unknown,
  key: string,
): Promise<{ replay: unknown } | { proceed: true }> {
  cleanup();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return { replay: cached.response };
  const sql = getSql(env);
  if (!sql) return { proceed: true };
  try {
    const [reserved] = await sql`
      INSERT INTO idempotency_keys (key) VALUES (${key})
      ON CONFLICT (key) DO NOTHING RETURNING key`;
    if (reserved) return { proceed: true };
    for (let i = 0; i < 20; i += 1) {
      const [row] = await sql`SELECT response FROM idempotency_keys WHERE key = ${key}`;
      if (row && row.response != null) {
        cache.set(key, { response: row.response, expires: Date.now() + TTL_MS });
        return { replay: row.response };
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { proceed: true };
  } catch {
    return { proceed: true };
  }
}

export async function rememberPaymentIdempotency(
  env: unknown,
  key: string,
  response: unknown,
): Promise<void> {
  cleanup();
  cache.set(key, { response, expires: Date.now() + TTL_MS });
  const sql = getSql(env);
  if (!sql) return;
  try {
    await sql`
      INSERT INTO idempotency_keys (key, response)
      VALUES (${key}, ${sql.json(JSON.parse(JSON.stringify(response)))})
      ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response`;
  } catch {
    // The in-process cache still protects this isolate; payment ledger IDs and
    // server intents remain the final duplicate boundary.
  }
}
