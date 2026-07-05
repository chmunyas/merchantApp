import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";

// Public base URL for shareable links. `app_settings.public_base_url` (set when a
// tunnel/deployment URL is known) wins, then env vars, then the local dev origin.
// Async so a link is always reachable from the customer's phone, not localhost.
export async function getBaseUrl(env: unknown): Promise<string> {
  try {
    const sql = getSql(env);
    if (sql) {
      const [row] = await sql`SELECT value FROM app_settings WHERE key = 'public_base_url'`;
      const url = (row?.value as { url?: string } | undefined)?.url;
      if (url) return url.replace(/\/+$/, "");
    }
  } catch {
    /* fall back */
  }
  return (
    envVar(env, "PUBLIC_BASE_URL") ??
    envVar(env, "VITE_BACKEND_URL") ??
    "http://localhost:8080"
  ).replace(/\/+$/, "");
}

// A short, tappable pay link: <base>/pay?i=<invoiceNumber>. The pay page loads
// the amount from the invoice number, so the URL stays short and clickable.
export function payLink(base: string, params: { number: string }): string {
  return `${base}/pay?i=${encodeURIComponent(params.number)}`;
}

export function bookLink(base: string, businessId = "main"): string {
  return `${base}/book/${businessId}`;
}

export function enquireLink(base: string): string {
  return `${base}/enquire`;
}
