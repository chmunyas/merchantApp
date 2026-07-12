// The real-time hub, as a Cloudflare Durable Object.
//
// Why a DO is REQUIRED: on Workers, module-level state (the old
// `merchantConnections` / `recentEvents` Maps) lives per-isolate, so a WebSocket
// accepted in one isolate can never be reached by a payment webhook that runs in
// another isolate — real-time silently degraded, and even the polling buffer was
// isolate-local. A Durable Object is a single, globally-addressable instance: we
// key one per merchant (`idFromName(merchantId)`), so every isolate routes that
// merchant's sockets and events to the SAME place. Live delivery uses the
// hibernatable WebSocket API; the polling fallback reads a durable ring buffer, so
// BOTH transports are now correct across isolates.

interface HubWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface HubStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

interface HubState {
  acceptWebSocket(ws: unknown): void;
  getWebSockets(): HubWebSocket[];
  storage: HubStorage;
}

type RecentEvent = { event: unknown; timestamp: string };

const RECENT_KEY = "recent";
const RECENT_LIMIT = 100;

export class RealtimeHub {
  private state: HubState;

  constructor(state: HubState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // A WebSocket upgrade (forwarded verbatim from /api/realtime) — detect by
    // header so the forwarded path doesn't matter.
    const upgrade = request.headers.get("Upgrade") || "";
    if (upgrade.toLowerCase() === "websocket") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const WSPair = (globalThis as any).WebSocketPair;
      if (!WSPair) {
        return new Response("websocket unsupported", { status: 501 });
      }
      const pair = new WSPair();
      const [client, server] = [pair[0], pair[1]];
      // Hibernation API: the runtime may evict the DO while the socket stays open
      // and wakes it to deliver, so an idle merchant dashboard costs nothing.
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "connected" }));
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }

    const url = new URL(request.url);

    // Fan a broadcast out to every live socket + append to the durable buffer.
    if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
      const event = await request.json().catch(() => null);
      const serialized = JSON.stringify(event);
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(serialized);
        } catch {
          /* a dead socket is cleaned up by the runtime on close */
        }
      }
      const recent = (await this.state.storage.get<RecentEvent[]>(RECENT_KEY)) ?? [];
      recent.push({ event, timestamp: new Date().toISOString() });
      if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
      await this.state.storage.put(RECENT_KEY, recent);
      return new Response(null, { status: 204 });
    }

    // Polling fallback — events since a timestamp (durable, so cross-isolate).
    if (url.pathname.endsWith("/notifications")) {
      const since = url.searchParams.get("since") || "";
      const recent = (await this.state.storage.get<RecentEvent[]>(RECENT_KEY)) ?? [];
      const filtered = since ? recent.filter((e) => e.timestamp > since) : recent;
      return new Response(JSON.stringify(filtered.map((e) => e.event)), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }

  // Required when using the hibernation API. The client never sends to us, so
  // messages are ignored; a closing socket is acknowledged so it is released.
  async webSocketMessage(_ws: HubWebSocket, _message: string | ArrayBuffer): Promise<void> {}

  async webSocketClose(
    ws: HubWebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close(code === 1006 ? 1000 : code);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(_ws: HubWebSocket, _error: unknown): Promise<void> {}
}
