import { envVar } from "@/lib/env";

// Minimal, dependency-free Sentry client. Sends an exception event to the DSN's
// ingest endpoint when SENTRY_DSN is set; otherwise a pure no-op. Never throws —
// observability must never break a request. Wire real error tracking by setting
// SENTRY_DSN (+ optional SENTRY_ENVIRONMENT).
export async function captureException(
  env: unknown,
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const dsn = envVar(env, "SENTRY_DSN");
  if (!dsn) return;
  try {
    // DSN shape: https://<publicKey>@<host>/<projectId>
    const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
    if (!m) return;
    const [, publicKey, host, projectId] = m;
    const err = error instanceof Error ? error : new Error(String(error));
    const body = JSON.stringify({
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      platform: "javascript",
      level: "error",
      environment: envVar(env, "SENTRY_ENVIRONMENT") ?? "production",
      exception: {
        values: [
          {
            type: err.name,
            value: err.message,
            stacktrace: {
              frames: String(err.stack ?? "")
                .split("\n")
                .slice(1, 30)
                .map((line) => ({ function: line.trim() })),
            },
          },
        ],
      },
      extra: context,
    });
    await fetch(`https://${host}/api/${projectId}/store/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=pesaswap/1.0`,
      },
      body,
    });
  } catch {
    /* swallow — never let error reporting throw */
  }
}
