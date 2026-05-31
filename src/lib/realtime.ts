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
  on(eventType: RealtimeEvent["type"] | "*", handler: EventHandler): () => void {
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
      this.ws = new WebSocket(`${wsUrl}/api/realtime?merchant=${encodeURIComponent(this.merchantId)}`);

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
      console.warn("[PesaSwap] Max reconnect attempts reached, falling back to polling");
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
        const response = await fetch(
          `${this.backendUrl}/api/notifications?merchant=${encodeURIComponent(this.merchantId)}&since=${encodeURIComponent(lastChecked)}`,
        );
        if (response.ok) {
          const events = (await response.json()) as RealtimeEvent[];
          events.forEach((event) => this.dispatch(event));
          lastChecked = new Date().toISOString();
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

import { useEffect, useRef, useCallback } from "react";

/**
 * React hook for subscribing to real-time PesaSwap events.
 *
 * @example
 * usePesaSwapEvent("payment.succeeded", (event) => {
 *   toast.success(`Payment received: KES ${event.data.amount}`);
 * });
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
export function usePesaSwapRealtime(merchantId: string): { connected: boolean } {
  useEffect(() => {
    realtime.connect(merchantId);
    return () => realtime.disconnect();
  }, [merchantId]);

  // Re-render on connection changes would need state, keeping it simple
  return { connected: realtime.isConnected() };
}
