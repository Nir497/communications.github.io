import type { SyncEvent } from "../types";

type Handler = (event: SyncEvent) => void;

export class SyncBus {
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<Handler>();
  private storageKey = "ltx:lastSyncPing";
  private onStorage = (event: StorageEvent): void => {
    if (event.key !== this.storageKey || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as SyncEvent;
      this.emit(parsed);
    } catch {
      // ignore malformed sync payloads
    }
  };

  constructor() {
    if ("BroadcastChannel" in window) {
      this.channel = new BroadcastChannel("ltx-sync");
      this.channel.onmessage = (event: MessageEvent<SyncEvent>) => {
        this.emit(event.data);
      };
    }
    window.addEventListener("storage", this.onStorage);
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(event: SyncEvent): void {
    this.channel?.postMessage(event);
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(event));
    } catch {
      // ignore
    }
    this.emit(event);
  }

  destroy(): void {
    window.removeEventListener("storage", this.onStorage);
    this.channel?.close();
  }

  private emit(event: SyncEvent): void {
    this.handlers.forEach((handler) => handler(event));
  }
}
