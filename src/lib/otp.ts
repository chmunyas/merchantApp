// Passwordless one-time codes shared across channels (email / WhatsApp / SMS).
// Codes are never stored in the clear — only a SHA-256 hash peppered with the
// server's JWT secret, so a DB read can't reveal a live code.
const encoder = new TextEncoder();

// A uniform 6-digit code (leading zeros preserved).
export function generateOtpCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function hashOtp(
  code: string,
  destination: string,
  pepper: string,
): Promise<string> {
  const data = encoder.encode(`${code}:${destination.toLowerCase()}:${pepper}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Normalise the identity: email → lowercase; phone → E.164 (Kenya default).
export function normalizeDestination(channel: string, dest: string): string {
  const raw = String(dest ?? "").trim();
  if (!raw) return "";
  if (channel === "email") return raw.toLowerCase();
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.length === 9) return `+254${digits}`;
  return `+${digits}`;
}
