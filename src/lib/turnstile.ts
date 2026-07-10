import { envVar } from "@/lib/env";

// Cloudflare Turnstile verification for account-creation entry points (signup,
// OTP request). Returns true when NOT configured (no TURNSTILE_SECRET) so it is a
// pure no-op until you enable it; once enabled, a missing/invalid token fails
// closed. Add the Turnstile widget on the client and pass its token as
// `turnstileToken`.
export async function verifyTurnstile(
  env: unknown,
  token: string | undefined,
  ip?: string | null,
): Promise<boolean> {
  const secret = envVar(env, "TURNSTILE_SECRET");
  if (!secret) return true; // not configured → skip
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set("remoteip", ip);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form },
    );
    const data = (await res.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch {
    return false; // fail closed on a verify error when protection is enabled
  }
}
