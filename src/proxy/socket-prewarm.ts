import { connect as connectTcp, type Socket } from "node:net";

const PREWARM_SOCKET_IDLE_MS = 2_000;
const PREWARM_CACHE_MAX_SIZE = 64;

interface PrewarmedSocketEntry {
  socket: Socket;
  idleTimer: ReturnType<typeof setTimeout>;
}

const cache = new Map<string, PrewarmedSocketEntry>();

function key(host: string, port: number): string {
  return `${host}:${port}`;
}

export function takePrewarmedSocket(
  host: string,
  port: number,
): Socket | undefined {
  const entry = cache.get(key(host, port));
  if (!entry) {
    return undefined;
  }

  cache.delete(key(host, port));
  clearTimeout(entry.idleTimer);

  if (
    entry.socket.destroyed ||
    !entry.socket.readable ||
    !entry.socket.writable
  ) {
    entry.socket.destroy();
    return undefined;
  }

  return entry.socket;
}

export function prewarmRelaySocket(host: string, port: number): void {
  const k = key(host, port);
  if (cache.has(k)) {
    return;
  }

  // Evict oldest entry if at capacity
  if (cache.size >= PREWARM_CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = cache.get(oldestKey);
      clearTimeout(oldest?.idleTimer);
      oldest?.socket.destroy();
      cache.delete(oldestKey);
    }
  }

  const socket = connectTcp({ host, port });
  socket.once("connect", () => {
    if (socket.destroyed || !socket.readable || !socket.writable) {
      socket.destroy();
      return;
    }

    const existing = cache.get(k);
    if (existing) {
      clearTimeout(existing.idleTimer);
      existing.socket.destroy();
      socket.destroy();
      return;
    }

    const cleanup = () => {
      if (cache.get(k)?.socket === socket) {
        cache.delete(k);
      }
    };

    const idleTimer = setTimeout(() => {
      cleanup();
      socket.destroy();
    }, PREWARM_SOCKET_IDLE_MS);
    idleTimer.unref?.();

    socket.once("close", cleanup);
    socket.once("end", cleanup);
    socket.once("error", cleanup);
    cache.set(k, { socket, idleTimer });
  });
  socket.once("error", () => {
    socket.destroy();
  });
}
