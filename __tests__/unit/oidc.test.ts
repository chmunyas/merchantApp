import { describe, it, expect, vi, afterEach } from "vitest";

import { verifyIdToken } from "../../src/lib/oidc";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

// Mint a real RS256-signed id_token + the matching public JWK.
async function makeToken(
  claims: Record<string, unknown>,
  kid = "k1",
): Promise<{ token: string; jwk: JsonWebKey }> {
  const kp = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const payload = b64urlStr(JSON.stringify(claims));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      kp.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  );
  return { token: `${header}.${payload}.${b64url(sig)}`, jwk };
}

function stubJwks(jwk: JsonWebKey) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))),
  );
}

const OPTS = {
  jwksUrl: "https://idp.test/jwks",
  issuer: "https://idp.test",
  clientId: "client-1",
};

describe("verifyIdToken (OIDC RS256)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a valid, correctly-signed token", async () => {
    const { token, jwk } = await makeToken({
      iss: "https://idp.test",
      aud: "client-1",
      sub: "u1",
      email: "owner@company.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: "n1",
    });
    stubJwks(jwk);
    const claims = await verifyIdToken(token, { ...OPTS, nonce: "n1" });
    expect(claims?.email).toBe("owner@company.com");
    expect(claims?.sub).toBe("u1");
  });

  it("rejects a tampered signature", async () => {
    const { token, jwk } = await makeToken({
      iss: "https://idp.test",
      aud: "client-1",
      sub: "u1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    stubJwks(jwk);
    expect(await verifyIdToken(`${token}AA`, OPTS)).toBeNull();
  });

  it("rejects a wrong audience or wrong nonce", async () => {
    const { token, jwk } = await makeToken({
      iss: "https://idp.test",
      aud: "client-1",
      sub: "u1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: "n1",
    });
    stubJwks(jwk);
    expect(await verifyIdToken(token, { ...OPTS, clientId: "other" })).toBeNull();
    expect(await verifyIdToken(token, { ...OPTS, nonce: "bad" })).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { token, jwk } = await makeToken({
      iss: "https://idp.test",
      aud: "client-1",
      sub: "u1",
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    stubJwks(jwk);
    expect(await verifyIdToken(token, OPTS)).toBeNull();
  });

  it("rejects a non-RS256 alg", async () => {
    const header = b64urlStr(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = b64urlStr(JSON.stringify({ sub: "u1" }));
    expect(await verifyIdToken(`${header}.${payload}.`, OPTS)).toBeNull();
  });
});
