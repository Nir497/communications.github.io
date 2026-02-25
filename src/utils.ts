const COLORS = [
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#6366f1",
  "#14b8a6",
  "#f97316",
  "#22c55e",
];

export function createId(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}

export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes;
  let idx = -1;
  do {
    size /= 1024;
    idx += 1;
  } while (size >= 1024 && idx < units.length - 1);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[idx]}`;
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function readHash(): { route: "home" | "chat"; chatId?: string } {
  const raw = window.location.hash || "#/";
  const match = raw.match(/^#\/chat\/(.+)$/);
  if (match) {
    return { route: "chat", chatId: decodeURIComponent(match[1]) };
  }
  return { route: "home" };
}

export function navigateToChat(chatId: string): void {
  window.location.hash = `#/chat/${encodeURIComponent(chatId)}`;
}

export function navigateHome(): void {
  window.location.hash = "#/";
}
