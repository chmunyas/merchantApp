// Verifiable Intent Framework: sign + verify an agent's spending intent with
// HMAC-SHA256, giving banks a tamper-evident proof that a transaction matches a
// specific authorised intent. `canonicalIntent` is a stable serialization so the
// same intent always produces the same signature.

const encoder = new TextEncoder();

export type IntentPayload = {
  agentRef: string;
  userRef?: string;
  merchant: string;
  amount: number;
  currency: string;
  timestamp: number;
  context?: string;
};

export function canonicalIntent(p: IntentPayload): string {
  return JSON.stringify({
    agentRef: p.agentRef ?? "",
    userRef: p.userRef ?? "",
    merchant: p.merchant ?? "",
    amount: Math.round(Number(p.amount) || 0),
    currency: p.currency ?? "KES",
    timestamp: Math.round(Number(p.timestamp) || 0),
    context: p.context ?? "",
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

export function signIntent(
  payload: IntentPayload,
  secret: string,
): Promise<string> {
  return hmacHex(canonicalIntent(payload), secret);
}

// Constant-time comparison of the recomputed signature against the provided one.
export async function verifyIntent(
  payload: IntentPayload,
  signature: string,
  secret: string,
): Promise<boolean> {
  const expected = await hmacHex(canonicalIntent(payload), secret);
  if (typeof signature !== "string" || expected.length !== signature.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}
