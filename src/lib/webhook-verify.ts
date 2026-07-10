const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export function verifyToken(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  return constantTimeBytesEqual(encoder.encode(provided), encoder.encode(expected));
}

// Verify a rotating, signed peer token for A2A calls. A trusted peer presents:
//   x-agent-id, x-agent-timestamp (unix seconds), x-agent-signature
//   signature = hex( HMAC-SHA256(secret, `${agentId}.${timestamp}`) )
// The timestamp bounds replay: a signature is only valid within `windowSec` of
// now, so tokens "rotate" every request and expire quickly. Returns false when
// anything is missing/mismatched or the clock skew is too large.
export async function verifyPeerSignature(
  agentId: string | null,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  windowSec = 300,
): Promise<boolean> {
  if (!agentId || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > windowSec) return false;
  const provided = hexToBytes(signature.trim().toLowerCase());
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${agentId}.${timestamp}`),
  );
  const expected = hexToBytes(bytesToHex(new Uint8Array(sig)));
  return expected ? constantTimeBytesEqual(provided, expected) : false;
}

export async function verifyHubSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  const prefix = "sha256=";
  if (!header?.startsWith(prefix)) return false;
  const provided = hexToBytes(header.slice(prefix.length));
  if (!provided) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expectedHex = bytesToHex(new Uint8Array(signature));
  const expected = hexToBytes(expectedHex);
  return expected ? constantTimeBytesEqual(provided, expected) : false;
}
