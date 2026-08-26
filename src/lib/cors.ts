import { envVar } from "@/lib/env";

// Resolve the Access-Control-Allow-Origin to apply to an API response.
//
// Default (CORS_ALLOWED_ORIGIN unset) permits same-origin requests only. Set
// CORS_ALLOWED_ORIGIN in production (a single origin, a comma-separated
// allowlist, or "*") to lock cross-origin access to the app's own domain(s):
//   - "*"                       → allow all (explicit opt-in)
//   - "https://app.example.com" → only that origin
//   - "https://a.com,https://b.com" → reflect only an allowlisted Origin.
export function resolveCorsOrigin(request: Request, env: unknown): string | null {
  const raw = envVar(env, "CORS_ALLOWED_ORIGIN");
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (!raw || !raw.trim()) return null;
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return null;
  if (allow.includes("*")) return "*";
  if (origin && allow.some((a) => a.toLowerCase() === origin.toLowerCase())) {
    return origin;
  }
  return null;
}
