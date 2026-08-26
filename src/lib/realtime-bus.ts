// A2.4 — the live bill bus.
//
// The remaining balance on a shared check must drop on every guest's phone the
// moment someone else pays, without anyone refreshing. Polling is the fallback,
// not the design.
//
// `src/realtime-do.ts` already is the correct hub on Workers: a Durable Object
// is a single globally-addressable instance, so an event emitted from the
// isolate that handled a payment webhook reaches a socket accepted in a
// different isolate. The merchant dashboard addresses one instance per merchant
// (`idFromName(merchantId)`); this module addresses one instance per TOPIC.
//
// A topic is a string like `bill:<orderId>`. Addressing the DO by the topic name
// gives per-bill isolation for free — a guest socket subscribed to their own
// check can never be handed another table's events, because it is not connected
// to that object at all. No filtering logic, no leak surface.
//
// In dev (single-process node SSR) there is no DO binding, so a process-local
// registry stands in. That is correct there precisely because everything shares
// one process — which is exactly why it is NOT correct on Workers.

type HubStub = { fetch(req: Request): Promise<Response> };

type RealtimeBinding = {
  idFromName(name: string): unknown;
  get(id: unknown): HubStub;
};

export type BillEvent = {
  type: "bill.updated";
  data: {
    order_id: string;
    total: number;
    paid: number;
    remaining: number;
    /** Lines no longer selectable: reserved by, or already paid by, someone else. */
    taken_item_ids?: string[];
    timestamp: string;
  };
};

/** The topic every guest paying the same check subscribes to. */
export function billTopic(orderId: string): string {
  return `bill:${orderId}`;
}

function hubFor(env: unknown, topic: string): HubStub | null {
  const binding = (env as { REALTIME?: RealtimeBinding } | undefined)?.REALTIME;
  if (!binding || !topic) return null;
  return binding.get(binding.idFromName(topic));
}

// Dev-only fallback state. Bounded so a long-lived dev server cannot grow
// without limit.
const TOPIC_BUFFER_LIMIT = 50;
const localSockets = new Map<string, Set<{ send(data: string): void }>>();
const localBuffer = new Map<string, Array<{ event: unknown; timestamp: string }>>();

/** Fan an event out to every subscriber of a topic. Never throws. */
export async function publishToTopic(
  env: unknown,
  topic: string,
  event: BillEvent,
): Promise<void> {
  const hub = hubFor(env, topic);
  if (hub) {
    try {
      await hub.fetch(
        new Request("https://hub/broadcast", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
        }),
      );
    } catch {
      /* real-time is never allowed to fail a payment flow */
    }
    return;
  }

  const serialized = JSON.stringify(event);
  for (const socket of localSockets.get(topic) ?? []) {
    try {
      socket.send(serialized);
    } catch {
      /* a dead socket is dropped on close */
    }
  }
  const buffer = localBuffer.get(topic) ?? [];
  buffer.push({ event, timestamp: new Date().toISOString() });
  if (buffer.length > TOPIC_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - TOPIC_BUFFER_LIMIT);
  }
  localBuffer.set(topic, buffer);
}

/** Upgrade a request to a WebSocket subscribed to `topic`. */
export async function subscribeToTopic(
  request: Request,
  env: unknown,
  topic: string,
): Promise<Response> {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response(
      JSON.stringify({ error: "expected websocket upgrade" }),
      { status: 426, headers: { "content-type": "application/json" } },
    );
  }

  const hub = hubFor(env, topic);
  if (hub) return hub.fetch(request);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WSPair = (globalThis as any).WebSocketPair;
  if (!WSPair) {
    return new Response(
      JSON.stringify({ error: "websocket unsupported in this runtime" }),
      { status: 501, headers: { "content-type": "application/json" } },
    );
  }
  const pair = new WSPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  if (!localSockets.has(topic)) localSockets.set(topic, new Set());
  localSockets.get(topic)!.add(server);
  server.addEventListener("close", () => {
    const set = localSockets.get(topic);
    set?.delete(server);
    if (set && set.size === 0) localSockets.delete(topic);
  });
  server.send(JSON.stringify({ type: "connected" }));
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}

/** Polling fallback for a client whose WebSocket could not be established. */
export async function topicEventsSince(
  env: unknown,
  topic: string,
  since: string,
): Promise<unknown[]> {
  const hub = hubFor(env, topic);
  if (hub) {
    try {
      const response = await hub.fetch(
        new Request(
          `https://hub/notifications?since=${encodeURIComponent(since)}`,
        ),
      );
      const events = await response.json();
      return Array.isArray(events) ? events : [];
    } catch {
      return [];
    }
  }
  const buffer = localBuffer.get(topic) ?? [];
  const filtered = since ? buffer.filter((e) => e.timestamp > since) : buffer;
  return filtered.map((e) => e.event);
}
