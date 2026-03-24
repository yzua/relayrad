import type { Socket } from "node:net";

const DEFAULT_MAX_HEADER_BYTES = 64 * 1024;

export function readUntilHeaderEnd(
  socket: Socket,
  timeoutMs: number,
  maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    let trailingBytes = Buffer.alloc(0);
    const headerEndMarker = Buffer.from("\r\n\r\n");
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

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      totalLength += chunk.length;

      if (totalLength > maxHeaderBytes) {
        settleWithError(
          new Error(`Upstream headers exceeded ${maxHeaderBytes} bytes`),
        );
        return;
      }

      const window =
        trailingBytes.length > 0
          ? Buffer.concat([trailingBytes, chunk])
          : chunk;

      if (window.includes(headerEndMarker)) {
        settleWithBuffer(Buffer.concat(chunks, totalLength));
        return;
      }

      trailingBytes =
        window.length > 3
          ? Buffer.from(window.subarray(window.length - 3))
          : Buffer.from(window);
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
