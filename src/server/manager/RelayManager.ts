import { WebSocket } from "ws";

interface RelayPhotoPayload {
  type: "photo";
  source: "glasses";
  requestId: string;
  timestamp: number;
  mimeType: string;
  filename: string;
  size: number;
  userId: string;
  dataUrl: string;
}

/**
 * RelayManager — maintains a websocket client connection to an external relay
 * and publishes glasses photo payloads from the backend.
 */
export class RelayManager {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedMessages: string[] = [];

  private readonly relayUrl =
    process.env.RELAY_WS_URL || "ws://127.0.0.1:6000/publish";
  private readonly enabled = process.env.RELAY_WS_ENABLED !== "false";

  private connect(): void {
    if (!this.enabled) return;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.socket = new WebSocket(this.relayUrl);

    this.socket.on("open", () => {
      console.log(`[RelayManager] Connected to relay at ${this.relayUrl}`);
      this.flushQueue();
    });

    this.socket.on("close", () => {
      console.warn("[RelayManager] Relay connection closed");
      this.socket = null;
      this.scheduleReconnect();
    });

    this.socket.on("error", (error) => {
      console.error("[RelayManager] Relay websocket error:", error);
    });
  }

  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    while (this.queuedMessages.length > 0) {
      const nextMessage = this.queuedMessages.shift();
      if (nextMessage) {
        this.socket.send(nextMessage);
      }
    }
  }

  publishPhoto(payload: RelayPhotoPayload): void {
    if (!this.enabled) return;

    const serializedPayload = JSON.stringify(payload);

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queuedMessages.push(serializedPayload);
      this.connect();
      return;
    }

    this.socket.send(serializedPayload);
  }

  destroy(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
    this.queuedMessages = [];
  }
}

export const relayManager = new RelayManager();
