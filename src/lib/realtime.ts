import { getToken } from "@/lib/auth";

/**
 * PesaSwap Real-Time Notifications
 * WebSocket-based merchant notifications with fallback polling.
 *
 * Flow:
 * 1. Payment succeeds → PesaSwap webhook hits server
 * 2. Server broadcasts via WebSocket to connected merchant
 * 3. Merchant tablet/phone gets instant notification (1-3s vs 5-10s webhook-only)
 * 4. Fallback: if WebSocket disconnected, client polls every 5s
 */

export type RealtimeEvent =
  | { type: "payment.succeeded"; data: PaymentNotification }
  | { type: "payment.failed"; data: PaymentNotification }
  | { type: "payment.refunded"; data: RefundNotification }
  | { type: "order.placed"; data: OrderNotification }
  | { type: "table.updated"; data: TableNotification }
  | { type: "walkout.alert"; data: WalkoutNotification };

export type PaymentNotification = {
  payment_id: string;
  amount: number;
  currency: string;
  table_number?: number;
  customer_phone: string;
  customer_name?: string;
  tip_amount?: number;
  server_name?: string;
  split_info?: string;
  items?: string;
  timestamp: string;
};

export type RefundNotification = {
  refund_id: string;
  payment_id: string;
  amount: number;
  reason: string;
  refunded_by: string;
  timestamp: string;
};

export type OrderNotification = {
  order_id: string;
  table_number: number;
  destination: "kitchen" | "bar";
  items: Array<{ name: string; qty: number; notes?: string }>;
  timestamp: string;
};

export type TableNotification = {
  table_number: number;
  status: "opened" | "paid" | "closed";
  paid_amount?: number;
  total_amount?: number;
  timestamp: string;
};

export type WalkoutNotification = {
  table_number: number;
  outstanding_amount: number;
  duration_minutes: number;
  timestamp: string;
};

type EventHandler = (event: RealtimeEvent) => void;

// --- Audio Notification ---

function playNotificationSound(type: "payment" | "alert" | "order") {
  if (typeof window === "undefined") return;

  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      case "payment":
        // Pleasant "ka-ching" — two ascending tones
        oscillator.frequency.setValueAtTime(880, ctx.currentTime);
        oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.4);
        break;

      case "order":
        // Short double beep
        oscillator.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.3);
        break;

      case "alert":
        // Urgent triple beep
        oscillator.frequency.setValueAtTime(1000, ctx.currentTime);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.4, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.4, ctx.currentTime + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.5);
        break;
    }
  } catch {
    // Audio not available — silent fallback
  }
}

// --- RealtimeManager ---

class RealtimeManager {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private merchantId: string = "";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private backendUrl: string;

  constructor(backendUrl?: string) {
    this.backendUrl = backendUrl || import.meta.env.VITE_BACKEND_URL || "";
  }

  /**
   * Connect to real-time notification stream
   */
  connect(merchantId: string): void {
    this.merchantId = merchantId;
    this.connectWebSocket();
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    this.connected = false;
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPolling();
  }

  /**
   * Subscribe to specific event types
   */
  on(
    eventType: RealtimeEvent["type"] | "*",
    handler: EventHandler,
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  // --- WebSocket connection ---

  private connectWebSocket(): void {
    if (typeof window === "undefined") return;

    const wsUrl = this.backendUrl.replace(/^http/, "ws");
    if (!wsUrl) {
      // No backend configured — use polling fallback
      this.startPolling();
      return;
    }

    try {
      this.ws = new WebSocket(
        `${wsUrl}/api/realtime?merchant=${encodeURIComponent(this.merchantId)}`,
      );

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.stopPolling(); // WebSocket connected, stop polling
        console.info("[PesaSwap] Real-time connected");
      };

      this.ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as RealtimeEvent;
          this.dispatch(event);
        } catch {
          console.warn("[PesaSwap] Invalid WebSocket message");
        }
      };

      this.ws.onclose = (evt) => {
        this.connected = false;
        if (evt.code !== 1000) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.connected = false;
        // Will trigger onclose → reconnect
      };
    } catch {
      this.startPolling();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        "[PesaSwap] Max reconnect attempts reached, falling back to polling",
      );
      this.startPolling();
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  // --- Polling fallback ---

  private startPolling(): void {
    if (this.pollTimer) return;
    let lastChecked = new Date().toISOString();

    this.pollTimer = setInterval(async () => {
      try {
        const token = getToken();
        const response = await fetch(
          `${this.backendUrl}/api/notifications?merchant=${encodeURIComponent(this.merchantId)}&since=${encodeURIComponent(lastChecked)}`,
          token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
        );
        if (response.ok) {
          const events = (await response.json()) as RealtimeEvent[];
          events.forEach((event) => this.dispatch(event));
          lastChecked = new Date().toISOString();
        } else if (response.status === 401 || response.status === 403) {
          // The session expired, was revoked, or no longer carries membership.
          // Stop the financial poll until the app explicitly reconnects after a
          // new auth event instead of producing an endless protected-route loop.
          this.stopPolling();
        }
      } catch {
        // Network error — continue polling
      }
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // --- Event dispatch ---

  private dispatch(event: RealtimeEvent): void {
    // Play appropriate notification sound
    switch (event.type) {
      case "payment.succeeded":
        playNotificationSound("payment");
        break;
      case "payment.failed":
      case "walkout.alert":
        playNotificationSound("alert");
        break;
      case "order.placed":
        playNotificationSound("order");
        break;
    }

    // Notify specific handlers
    const specificHandlers = this.handlers.get(event.type);
    if (specificHandlers) {
      specificHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (err) {
          console.error(`[PesaSwap] Event handler error:`, err);
        }
      });
    }

    // Notify wildcard handlers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (err) {
          console.error(`[PesaSwap] Wildcard handler error:`, err);
        }
      });
    }
  }
}

// --- Singleton export ---

export const realtime = new RealtimeManager();

// --- React Hook ---

import { useEffect, useRef, useCallback, useState } from "react";

/**
 * React hook for subscribing to real-time PesaSwap events.
 */
export function usePesaSwapEvent(
  eventType: RealtimeEvent["type"] | "*",
  handler: EventHandler,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const stableHandler = useCallback((event: RealtimeEvent) => {
    handlerRef.current(event);
  }, []);

  useEffect(() => {
    const unsubscribe = realtime.on(eventType, stableHandler);
    return unsubscribe;
  }, [eventType, stableHandler]);
}

/**
 * Hook to connect/disconnect realtime on mount/unmount
 */
export function usePesaSwapRealtime(merchantId: string): {
  connected: boolean;
} {
  useEffect(() => {
    realtime.connect(merchantId);
    return () => realtime.disconnect();
  }, [merchantId]);

  return { connected: realtime.isConnected() };
}

// ============================================================
// LOCAL ORDER BUS — BroadcastChannel for cross-tab communication
// This enables customer tab → kitchen tab real-time in demo mode.
// ============================================================

export type OrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled";

export type KitchenOrder = {
  id: string;
  tableId: string;
  tableNumber: number;
  items: KitchenOrderItem[];
  status: OrderStatus;
  total: number;
  customerNote?: string;
  fulfilment: "dine-in" | "takeaway" | "delivery";
  scheduledAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KitchenOrderItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string;
  options?: string[];
};

type OrderBusMessage =
  | { type: "order:new"; order: KitchenOrder }
  | { type: "order:status"; orderId: string; status: OrderStatus }
  | { type: "order:sync"; orders: KitchenOrder[] };

type OrderBusListener = (msg: OrderBusMessage) => void;

const ORDER_CHANNEL_NAME = "pesaswap:orders";
const ORDERS_STORAGE_KEY = "pesaswap.kitchen.orders";

let orderChannel: BroadcastChannel | null = null;
const orderListeners = new Set<OrderBusListener>();

function getOrderChannel(): BroadcastChannel {
  if (!orderChannel && typeof BroadcastChannel !== "undefined") {
    orderChannel = new BroadcastChannel(ORDER_CHANNEL_NAME);
    orderChannel.onmessage = (evt: MessageEvent<OrderBusMessage>) => {
      orderListeners.forEach((fn) => fn(evt.data));
    };
  }
  return orderChannel!;
}

export function subscribeOrders(listener: OrderBusListener): () => void {
  orderListeners.add(listener);
  getOrderChannel();
  return () => {
    orderListeners.delete(listener);
  };
}

function broadcastOrder(msg: OrderBusMessage): void {
  try {
    getOrderChannel()?.postMessage(msg);
  } catch {
    /* SSR / no BroadcastChannel */
  }
  // Also notify local listeners (same tab)
  orderListeners.forEach((fn) => fn(msg));
}

export function generateOrderId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `ORD-${rand}-${ts}`;
}

export function getKitchenOrders(): KitchenOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KitchenOrder[]) : [];
  } catch {
    return [];
  }
}

export function saveKitchenOrders(orders: KitchenOrder[]): void {
  localStorage.setItem(
    ORDERS_STORAGE_KEY,
    JSON.stringify(orders.slice(0, 200)),
  );
}

/** Customer calls this when placing an order */
export function submitNewOrder(order: KitchenOrder): void {
  const orders = getKitchenOrders();
  orders.unshift(order);
  saveKitchenOrders(orders);
  broadcastOrder({ type: "order:new", order });
}

/** Kitchen calls this to update order status */
export function updateKitchenOrderStatus(
  orderId: string,
  status: OrderStatus,
): KitchenOrder | null {
  const orders = getKitchenOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveKitchenOrders(orders);
  broadcastOrder({ type: "order:status", orderId, status });
  return order;
}

/** Clear completed orders older than N minutes */
export function clearOldOrders(maxAgeMinutes = 120): void {
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
  const orders = getKitchenOrders().filter((o) => {
    if (o.status === "served" || o.status === "cancelled") {
      return new Date(o.updatedAt).getTime() > cutoff;
    }
    return true;
  });
  saveKitchenOrders(orders);
}

/** React hook: live kitchen orders with real-time updates */
export function useKitchenOrders() {
  const [orders, setOrders] = useState<KitchenOrder[]>(() =>
    getKitchenOrders(),
  );

  useEffect(() => {
    // Sync on focus (in case another tab modified storage)
    const syncFromStorage = () => setOrders(getKitchenOrders());
    window.addEventListener("focus", syncFromStorage);
    window.addEventListener("storage", syncFromStorage);

    const unsub = subscribeOrders((msg) => {
      if (msg.type === "order:new") {
        setOrders((prev) => [
          msg.order,
          ...prev.filter((o) => o.id !== msg.order.id),
        ]);
      } else if (msg.type === "order:status") {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === msg.orderId
              ? {
                  ...o,
                  status: msg.status,
                  updatedAt: new Date().toISOString(),
                }
              : o,
          ),
        );
      } else if (msg.type === "order:sync") {
        setOrders(msg.orders);
      }
    });

    return () => {
      unsub();
      window.removeEventListener("focus", syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  return orders;
}
