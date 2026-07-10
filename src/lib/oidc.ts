// Minimal OIDC id_token verification (RS256) using Web Crypto — no dependencies,
// runs on Cloudflare Workers + Node. Verifies the JWT signature against the IdP's
// JWKS and checks issuer / audience / expiry / nonce. Supports the common RS256
// case (Okta, Entra ID, Google, Auth0, Keycloak…).

function b64urlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    "=",
  );
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(input))) as T;
}

type Jwk = {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
};

export type OidcClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
};

// Verify an id_token: RS256 signature (against jwksUrl) + iss/aud/exp/nonce.
// Returns the claims on success, else null. Never throws.
export async function verifyIdToken(
  idToken: string,
  opts: { jwksUrl: string; issuer: string; clientId: string; nonce?: string },
): Promise<OidcClaims | null> {
  try {
    const [headerB64, payloadB64, sigB64] = idToken.split(".");
    if (!headerB64 || !payloadB64 || !sigB64) return null;
    const header = b64urlToJson<{ alg: string; kid?: string }>(headerB64);
    if (header.alg !== "RS256") return null; // only RS256 supported here

    const jwks = (await (await fetch(opts.jwksUrl)).json()) as { keys: Jwk[] };
    const jwk =
      jwks.keys.find((k) => k.kid === header.kid && k.kty === "RSA") ??
      jwks.keys.find((k) => k.kty === "RSA");
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(sigB64) as unknown as BufferSource,
      data as unknown as BufferSource,
    );
    if (!ok) return null;

    const claims = b64urlToJson<OidcClaims>(payloadB64);
    // issuer must match (allow a trailing-slash difference)
    const norm = (s: string) => s.replace(/\/$/, "");
    if (claims.iss && norm(String(claims.iss)) !== norm(opts.issuer)) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(opts.clientId)) return null;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    if (opts.nonce && claims.nonce && claims.nonce !== opts.nonce) return null;
    return claims;
  } catch {
    return null;
  }
}
