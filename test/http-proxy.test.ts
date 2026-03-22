import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import {
  createServer as createHttpServer,
  request as httpRequest,
} from "node:http";
import {
  type AddressInfo,
  createConnection as createTcpConnection,
  createServer as createTcpServer,
  type Server,
  type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProxyRequestLogger } from "../src/logging/proxy-request-logger";
import type { RelayRecord } from "../src/relay/relay-types";
import { createServer } from "../src/server/server";

interface CapturedLogEvent {
  timestamp: string;
  requestType: "http" | "connect";
  destinationHost: string;
  destinationPort: number;
  relayHostname: string;
}

function createCapturedRequestLogger(events: CapturedLogEvent[]) {
  return {
    log(event: CapturedLogEvent) {
      events.push(event);
    },
    close() {},
  };
}

async function startHttpTargetServer() {
  const server = createHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`target:${req.method}:${req.url}`);
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  return server;
}

async function startMalformedHttpTargetServer() {
  const server = createTcpServer((socket) => {
    socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n");
    socket.end();
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );

  return server;
}

async function startSocks5Server() {
  let hitCount = 0;
  const server = createTcpServer((clientSocket) => {
    hitCount += 1;
    let buffer = Buffer.alloc(0);
    let stage: "greeting" | "request" | "tunnel" = "greeting";

    clientSocket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (stage === "greeting") {
        if (buffer.length < 3) {
          return;
        }

        const methodCount = buffer[1] ?? 0;
        const needed = 2 + methodCount;
        if (buffer.length < needed) {
          return;
        }

        buffer = buffer.subarray(needed);
        clientSocket.write(Buffer.from([0x05, 0x00]));
        stage = "request";
      }

      if (stage === "request") {
        if (buffer.length < 5) {
          return;
        }

        const atyp = buffer[3];
        let offset = 4;
        let host = "";

        if (atyp === 0x01) {
          if (buffer.length < offset + 4 + 2) {
            return;
          }
          host = Array.from(buffer.subarray(offset, offset + 4)).join(".");
          offset += 4;
        } else if (atyp === 0x03) {
          const length = buffer[offset] ?? 0;
          offset += 1;
          if (buffer.length < offset + length + 2) {
            return;
          }
          host = buffer.subarray(offset, offset + length).toString("utf8");
          offset += length;
        } else {
          clientSocket.destroy();
          return;
        }

        const port = buffer.readUInt16BE(offset);
        buffer = Buffer.alloc(0);

        const upstream = createTcpConnection({ host, port }, () => {
          clientSocket.write(
            Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]),
          );
          stage = "tunnel";
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        });

        upstream.on("error", () => {
          clientSocket.write(
            Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
          );
          clientSocket.destroy();
        });
      }
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  return {
    server,
    getHitCount() {
      return hitCount;
    },
  };
}

function relayForPort(port: number, hostname: string): RelayRecord {
  return {
    countryName: "Testland",
    countryCode: "tt",
    cityName: "Example",
    cityCode: "exp",
    hostname,
    ipv4: "127.0.0.1",
    ipv6: "::1",
    protocol: "WireGuard",
    provider: "Test",
    ownership: "owned",
    socks5Hostname: "127.0.0.1",
    socks5Port: port,
  };
}

describe("proxy routing", () => {
  let targetServer: ReturnType<typeof createHttpServer>;
  let socksServer: Server;
  let getSocksHitCount: () => number;
  let proxyServer: ReturnType<typeof createServer>;
  let proxyPort = 0;
  let targetPort = 0;
  let loggedEvents: CapturedLogEvent[] = [];

  beforeAll(async () => {
    loggedEvents = [];
    targetServer = await startHttpTargetServer();
    const socks = await startSocks5Server();
    socksServer = socks.server;
    getSocksHitCount = socks.getHitCount;

    targetPort = (targetServer.address() as AddressInfo).port;
    const socksPort = (socksServer.address() as AddressInfo).port;

    proxyServer = createServer({
      initialRelays: [relayForPort(socksPort, "tt-exp-wg-001")],
      refreshRelays: async () => [relayForPort(socksPort, "tt-exp-wg-001")],
      requestLogger: createCapturedRequestLogger(loggedEvents),
    });

    await proxyServer.listen(0, "127.0.0.1");
    proxyPort = (proxyServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await proxyServer.close();
    await new Promise<void>((resolve, reject) =>
      targetServer.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      socksServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  test("forwards plain HTTP requests through the selected SOCKS5 relay", async () => {
    loggedEvents.length = 0;

    const body = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: proxyPort,
          method: "GET",
          path: `http://127.0.0.1:${targetPort}/hello?via=http-proxy`,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => resolve(data));
        },
      );

      req.on("error", reject);
      req.end();
    });

    expect(body).toBe("target:GET:/hello?via=http-proxy");
    expect(getSocksHitCount()).toBeGreaterThan(0);
    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0]?.requestType).toBe("http");
    expect(loggedEvents[0]?.destinationHost).toBe("127.0.0.1");
    expect(loggedEvents[0]?.destinationPort).toBe(targetPort);
    expect(loggedEvents[0]?.relayHostname).toBe("tt-exp-wg-001");
  });

  test("supports HTTPS CONNECT tunneling through the selected relay", async () => {
    loggedEvents.length = 0;

    const socket = createTcpConnection({ host: "127.0.0.1", port: proxyPort });
    await once(socket, "connect");

    socket.write(
      `CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`,
    );

    let response = await readUntil(socket, "\r\n\r\n");
    expect(response.startsWith("HTTP/1.1 200")).toBe(true);

    socket.write(
      `GET /from-connect HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`,
    );
    response = await readUntil(socket, "target:GET:/from-connect");

    expect(response.includes("target:GET:/from-connect")).toBe(true);
    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0]?.requestType).toBe("connect");
    expect(loggedEvents[0]?.destinationHost).toBe("127.0.0.1");
    expect(loggedEvents[0]?.destinationPort).toBe(targetPort);
    expect(loggedEvents[0]?.relayHostname).toBe("tt-exp-wg-001");
    socket.destroy();
  });

  test("retries the next relay when the first upstream relay is unavailable", async () => {
    loggedEvents.length = 0;
    await proxyServer.close();

    const socksPort = (socksServer.address() as AddressInfo).port;
    proxyServer = createServer({
      initialRelays: [
        relayForPort(65_000, "tt-exp-wg-bad"),
        relayForPort(socksPort, "tt-exp-wg-good"),
      ],
      refreshRelays: async () => [relayForPort(socksPort, "tt-exp-wg-good")],
      requestLogger: createCapturedRequestLogger(loggedEvents),
    });

    await proxyServer.listen(0, "127.0.0.1");
    proxyPort = (proxyServer.address() as AddressInfo).port;

    const body = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: proxyPort,
          method: "GET",
          path: `http://127.0.0.1:${targetPort}/retry`,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => resolve(data));
        },
      );

      req.on("error", reject);
      req.end();
    });

    expect(body).toBe("target:GET:/retry");
    expect(loggedEvents).toHaveLength(1);
    expect(loggedEvents[0]?.relayHostname).toBe("tt-exp-wg-good");
  });

  test("returns 502 when upstream closes before full headers", async () => {
    loggedEvents.length = 0;
    const malformedTarget = await startMalformedHttpTargetServer();
    const malformedPort = (malformedTarget.address() as AddressInfo).port;

    const response = await new Promise<{ statusCode: number; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port: proxyPort,
            method: "GET",
            path: `http://127.0.0.1:${malformedPort}/broken`,
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => {
              resolve({ statusCode: res.statusCode ?? 0, body });
            });
          },
        );

        req.on("error", reject);
        req.end();
      },
    );

    await new Promise<void>((resolve, reject) =>
      malformedTarget.close((error) => (error ? reject(error) : resolve())),
    );

    expect(response.statusCode).toBe(502);
    expect(response.body).toContain("Upstream closed before headers completed");
    expect(loggedEvents).toHaveLength(0);
  });

  test("persists HTTP proxy logs to sqlite when storage logging is enabled", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "relayrad-logs-"));
    const dbPath = join(tempDir, "proxy.sqlite");
    const logger = createProxyRequestLogger({
      logProxyConsole: false,
      logProxySqlitePath: dbPath,
    });

    const socksPort = (socksServer.address() as AddressInfo).port;
    const sqliteProxyServer = createServer({
      initialRelays: [relayForPort(socksPort, "tt-exp-wg-001")],
      refreshRelays: async () => [relayForPort(socksPort, "tt-exp-wg-001")],
      requestLogger: logger,
    });

    try {
      await sqliteProxyServer.listen(0, "127.0.0.1");
      const sqliteProxyPort = (sqliteProxyServer.address() as AddressInfo).port;

      await new Promise<string>((resolve, reject) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port: sqliteProxyPort,
            method: "GET",
            path: `http://127.0.0.1:${targetPort}/sqlite-http`,
          },
          (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => resolve(data));
          },
        );

        req.on("error", reject);
        req.end();
      });

      logger.close();
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .query(
          "select request_type, destination_host, destination_port, relay_hostname from proxy_request_logs order by id desc limit 1",
        )
        .get() as
        | {
            request_type: string;
            destination_host: string;
            destination_port: number;
            relay_hostname: string;
          }
        | undefined;
      db.close();

      expect(row?.request_type).toBe("http");
      expect(row?.destination_host).toBe("127.0.0.1");
      expect(row?.destination_port).toBe(targetPort);
      expect(row?.relay_hostname).toBe("tt-exp-wg-001");
    } finally {
      await sqliteProxyServer.close();
      logger.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("persists CONNECT proxy logs to sqlite when storage logging is enabled", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "relayrad-logs-"));
    const dbPath = join(tempDir, "proxy.sqlite");
    const logger = createProxyRequestLogger({
      logProxyConsole: false,
      logProxySqlitePath: dbPath,
    });

    const socksPort = (socksServer.address() as AddressInfo).port;
    const sqliteProxyServer = createServer({
      initialRelays: [relayForPort(socksPort, "tt-exp-wg-001")],
      refreshRelays: async () => [relayForPort(socksPort, "tt-exp-wg-001")],
      requestLogger: logger,
    });

    try {
      await sqliteProxyServer.listen(0, "127.0.0.1");
      const sqliteProxyPort = (sqliteProxyServer.address() as AddressInfo).port;
      const socket = createTcpConnection({
        host: "127.0.0.1",
        port: sqliteProxyPort,
      });
      await once(socket, "connect");

      socket.write(
        `CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`,
      );
      await readUntil(socket, "\r\n\r\n");
      socket.destroy();

      logger.close();
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .query(
          "select request_type, destination_host, destination_port, relay_hostname from proxy_request_logs order by id desc limit 1",
        )
        .get() as
        | {
            request_type: string;
            destination_host: string;
            destination_port: number;
            relay_hostname: string;
          }
        | undefined;
      db.close();

      expect(row?.request_type).toBe("connect");
      expect(row?.destination_host).toBe("127.0.0.1");
      expect(row?.destination_port).toBe(targetPort);
      expect(row?.relay_hostname).toBe("tt-exp-wg-001");
    } finally {
      await sqliteProxyServer.close();
      logger.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("fails logger startup when sqlite path is unusable", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "relayrad-logs-"));
    const badPath = join(tempDir, "missing", "proxy.sqlite");

    try {
      expect(() =>
        createProxyRequestLogger({
          logProxyConsole: false,
          logProxySqlitePath: badPath,
        }),
      ).toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function readUntil(socket: Socket, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";

    const onData = (chunk: Buffer) => {
      data += chunk.toString("utf8");
      if (data.includes(marker)) {
        cleanup();
        resolve(data);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      resolve(data);
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
