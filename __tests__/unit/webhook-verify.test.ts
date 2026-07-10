import { describe, it, expect } from "vitest";

import { verifyPeerSignature } from "../../src/lib/webhook-verify";

const SECRET = "a2a_peer_secret_0123456789";

async function sign(agentId: string, ts: string, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const s = await crypto.subtle.sign("HMAC", key, enc.encode(`${agentId}.${ts}`));
  return Array.from(new Uint8Array(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const now = () => String(Math.floor(Date.now() / 1000));

describe("verifyPeerSignature (A2A rotating peer tokens)", () => {
  it("accepts a fresh, correctly-signed token", async () => {
    const ts = now();
    expect(await verifyPeerSignature("peerA", ts, await sign("peerA", ts), SECRET)).toBe(true);
  });

  it("rejects an expired timestamp (rotation window enforced)", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 1000);
    expect(await verifyPeerSignature("peerA", ts, await sign("peerA", ts), SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const ts = now();
    expect(
      await verifyPeerSignature("peerA", ts, await sign("peerA", ts, "nope"), SECRET),
    ).toBe(false);
  });

  it("rejects a tampered agent id (binds the id into the signature)", async () => {
    const ts = now();
    expect(await verifyPeerSignature("peerB", ts, await sign("peerA", ts), SECRET)).toBe(false);
  });

  it("rejects missing headers", async () => {
    expect(await verifyPeerSignature(null, null, null, SECRET)).toBe(false);
    expect(await verifyPeerSignature("peerA", now(), "", SECRET)).toBe(false);
  });
});
