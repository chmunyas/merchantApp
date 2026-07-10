// RFC 6238 TOTP (authenticator-app 2FA) with no external dependencies — pure
// Web Crypto (HMAC-SHA1), so it runs on Cloudflare Workers + Node alike.

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 base32 (no padding) — the encoding authenticator apps expect.
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Uint8Array | null {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// A fresh 20-byte (160-bit) base32 secret — the RFC-recommended TOTP key size.
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

// otpauth:// URI for the QR code an authenticator app scans.
export function totpUri(secret: string, account: string, issuer = "PesaSwap"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

async function hotp(secretBytes: Uint8Array, counter: number): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i -= 1) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, msg as unknown as BufferSource),
  );
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

// Verify a 6-digit code against the secret, tolerating ±1 time-step (clock skew).
export async function verifyTotp(
  secret: string,
  code: string,
  atMs: number = Date.now(),
): Promise<boolean> {
  const cleaned = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const secretBytes = base32Decode(secret);
  if (!secretBytes || secretBytes.length === 0) return false;
  const step = Math.floor(atMs / 1000 / 30);
  for (const w of [-1, 0, 1]) {
    if ((await hotp(secretBytes, step + w)) === cleaned) return true;
  }
  return false;
}
