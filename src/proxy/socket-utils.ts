import type { Socket } from "node:net";

const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;

// Marker bytes for \r\n\r\n
const M0 = 0x0d;
const M1 = 0x0a;
const M2 = 0x0d;
const M3 = 0x0a;

export function readUntilHeaderEnd(
  socket: Socket,
  timeoutMs: number,
  maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    // Keep last 3 bytes to detect \r\n\r\n split across chunks.
    // Stored as 3 separate byte values to avoid Buffer allocation.
    let hasTrailing = false;
    let t0 = 0;
    let t1 = 0;
    let t2 = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      settleWithError(new Error("Timed out waiting for upstream headers"));
    }, timeoutMs);

    const settleWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const settleWithBuffer = (buffer: Buffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.pause();
      resolve(buffer);
    };

    const foundInChunk = (chunk: Buffer): boolean => {
      // Fast path: check chunk alone for the marker
      if (chunk.includes("\r\n\r\n")) return true;

      // Check boundary with previous trailing bytes
      if (!hasTrailing || chunk.length === 0) return false;

      const cLen = chunk.length;
      // t2 + chunk[0..2]
      if (
        cLen >= 3 &&
        t2 === M0 &&
        chunk[0] === M1 &&
        chunk[1] === M2 &&
        chunk[2] === M3
      )
        return true;
      // t1,t2 + chunk[0..1]
      if (
        cLen >= 2 &&
        t1 === M0 &&
        t2 === M1 &&
        chunk[0] === M2 &&
        chunk[1] === M3
      )
        return true;
      // t0,t1,t2 + chunk[0]
      if (cLen >= 1 && t0 === M0 && t1 === M1 && t2 === M2 && chunk[0] === M3)
        return true;

      return false;
    };

    const updateTrailing = (chunk: Buffer) => {
      if (chunk.length >= 3) {
        t0 = chunk.readUInt8(chunk.length - 3);
        t1 = chunk.readUInt8(chunk.length - 2);
        t2 = chunk.readUInt8(chunk.length - 1);
      } else if (chunk.length === 2) {
        // Shift: keep last 3 from (t2, chunk[0], chunk[1])
        t0 = t2;
        t1 = chunk.readUInt8(0);
        t2 = chunk.readUInt8(1);
      } else if (chunk.length === 1) {
        t0 = t1;
        t1 = t2;
        t2 = chunk.readUInt8(0);
      }
      hasTrailing = true;
    };

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      totalLength += chunk.length;

      if (totalLength > maxHeaderBytes) {
        settleWithError(
          new Error(`Upstream headers exceeded ${maxHeaderBytes} bytes`),
        );
        return;
      }

      if (foundInChunk(chunk)) {
        settleWithBuffer(Buffer.concat(chunks, totalLength));
        return;
      }

      updateTrailing(chunk);
    };

    const onError = (error: Error) => settleWithError(error);

    const onCloseOrEnd = () =>
      settleWithError(new Error("Upstream closed before headers completed"));

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onCloseOrEnd);
      socket.off("end", onCloseOrEnd);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onCloseOrEnd);
    socket.on("end", onCloseOrEnd);
  });
}

export function waitForSocketDrain(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("drain", onDrain);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const onDrain = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Upstream socket closed before drain"));
    };

    socket.once("drain", onDrain);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

export function onceSocketClosed(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      socket.off("close", finish);
      socket.off("end", finish);
      resolve();
    };

    socket.once("close", finish);
    socket.once("end", finish);
  });
}

export function sendSocketError(
  socket: Socket,
  statusCode: number,
  statusText: string,
  body: string,
): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

export function readExact(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= count) {
        cleanup();
        resolve(Buffer.concat(chunks, received));
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Socket closed before data received"));
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}
