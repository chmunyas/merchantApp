import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/realtime-do";

// A minimal DurableObjectState stand-in: an in-memory socket list + storage map,
// mirroring the subset of the API the hub uses. This lets us prove the fan-out and
// durable polling buffer deterministically, without a live workerd/DO.
function makeState() {
  const sockets: Array<{ sent: string[]; send(d: string): void; close(): void }> = [];
  const store = new Map<string, unknown>();
  return {
    sockets,
    acceptWebSocket: (ws: unknown) =>
      sockets.push(ws as { sent: string[]; send(d: string): void; close(): void }),
    getWebSockets: () => sockets,
    storage: {
      get: async <T>(k: string) => store.get(k) as T | undefined,
      put: async (k: string, v: unknown) => {
        store.set(k, v);
      },
    },
  };
}

function fakeSocket() {
  const s = { sent: [] as string[], send(d: string) {}, close() {} };
  s.send = (d: string) => s.sent.push(d);
  return s;
}

const post = (event: unknown) =>
  new Request("https://hub/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });

describe("RealtimeHub durable object", () => {
  it("fans a broadcast out to every live socket", async () => {
    const state = makeState();
    const a = fakeSocket();
    const b = fakeSocket();
    state.sockets.push(a, b);
    const hub = new RealtimeHub(state);

    const res = await hub.fetch(post({ type: "payment.succeeded", data: { payment_id: "p1" } }));
    expect(res.status).toBe(204);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0]).type).toBe("payment.succeeded");
  });

  it("stores broadcasts in a durable buffer the polling fallback reads", async () => {
    const state = makeState();
    const hub = new RealtimeHub(state);

    await hub.fetch(post({ type: "payment.succeeded", data: { payment_id: "p2" } }));

    const all = await (
      await hub.fetch(new Request("https://hub/notifications"))
    ).json();
    expect(all).toHaveLength(1);
    expect(all[0].data.payment_id).toBe("p2");

    // `since` in the future returns nothing.
    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await (
      await hub.fetch(new Request(`https://hub/notifications?since=${future}`))
    ).json();
    expect(none).toEqual([]);
  });

  it("caps the durable buffer at 100 events", async () => {
    const state = makeState();
    const hub = new RealtimeHub(state);
    for (let i = 0; i < 105; i += 1) {
      await hub.fetch(post({ type: "x", data: { i } }));
    }
    const all = await (await hub.fetch(new Request("https://hub/notifications"))).json();
    expect(all).toHaveLength(100);
    // Oldest trimmed, newest kept.
    expect(all[all.length - 1].data.i).toBe(104);
  });
});
