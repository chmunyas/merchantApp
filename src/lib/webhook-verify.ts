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
