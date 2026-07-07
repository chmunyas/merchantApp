import { describe, it, expect } from "vitest";

import {
  canonicalIntent,
  signIntent,
  verifyIntent,
  type IntentPayload,
} from "../../src/lib/agent-intent";
import { sha256Hex } from "../../src/lib/hash";
import { resolveInitiator } from "../../src/lib/tx-initiator";

describe("resolveInitiator", () => {
  it("defaults to human", () => {
    expect(resolveInitiator(null)).toBe("human");
    expect(resolveInitiator({})).toBe("human");
    expect(resolveInitiator({ flow_type: "tapgo" })).toBe("human");
  });

  it("respects an explicit initiator", () => {
    expect(resolveInitiator({ initiator: "agent" })).toBe("agent");
    expect(resolveInitiator({ initiator: "HUMAN" })).toBe("human");
  });

  it("infers agent from an agent id or an A2A flow/channel", () => {
    expect(resolveInitiator({ agent_id: "AG-1" })).toBe("agent");
    expect(resolveInitiator({ agentRef: "AG-1" })).toBe("agent");
    expect(resolveInitiator({ flow_type: "a2a" })).toBe("agent");
    expect(resolveInitiator({ channel: "a2a" })).toBe("agent");
  });
});

describe("agent-intent signing", () => {
  const payload: IntentPayload = {
    agentRef: "AG-1",
    userRef: "U-1",
    merchant: "main",
    amount: 5000,
    currency: "KES",
    timestamp: 1700000000,
    context: "dinner",
  };

  it("canonicalises stably regardless of key order", () => {
    const a = canonicalIntent(payload);
    const b = canonicalIntent({
      context: "dinner",
      timestamp: 1700000000,
      currency: "KES",
      amount: 5000,
      merchant: "main",
      userRef: "U-1",
      agentRef: "AG-1",
    });
    expect(a).toBe(b);
  });

  it("round-trips sign/verify and rejects tampering", async () => {
    const sig = await signIntent(payload, "secret");
    expect(await verifyIntent(payload, sig, "secret")).toBe(true);
    expect(await verifyIntent({ ...payload, amount: 6000 }, sig, "secret")).toBe(
      false,
    );
    expect(await verifyIntent(payload, sig, "wrong-secret")).toBe(false);
    expect(await verifyIntent(payload, "deadbeef", "secret")).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("produces a stable 64-char hex digest and chains", async () => {
    const h = await sha256Hex("abc");
    expect(h).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const chained = await sha256Hex(h + "next");
    expect(chained).toMatch(/^[0-9a-f]{64}$/);
    expect(chained).not.toBe(h);
  });
});
