import { Database } from "bun:sqlite";

export interface ProxyRequestLogEvent {
  timestamp: string;
  requestType: "http" | "connect";
  destinationHost: string;
  destinationPort: number;
  relayHostname: string;
}

export interface ProxyRequestLogger {
  log(event: ProxyRequestLogEvent): void;
  close(): void;
}

export interface ProxyRequestLoggingOptions {
  logProxyConsole: boolean;
  logProxySqlitePath?: string;
}

interface StatementLike {
  run(...params: unknown[]): unknown;
}

export function createProxyRequestLogger(
  options: ProxyRequestLoggingOptions,
): ProxyRequestLogger {
  const loggers: ProxyRequestLogger[] = [];

  if (options.logProxyConsole) {
    loggers.push(createConsoleProxyRequestLogger());
  }

  if (options.logProxySqlitePath) {
    loggers.push(createSqliteProxyRequestLogger(options.logProxySqlitePath));
  }

  if (loggers.length === 0) {
    return createNoopProxyRequestLogger();
  }

  if (loggers.length === 1) {
    return loggers[0] ?? createNoopProxyRequestLogger();
  }

  return createCompositeProxyRequestLogger(loggers);
}

export function createNoopProxyRequestLogger(): ProxyRequestLogger {
  return {
    log() {},
    close() {},
  };
}

function createConsoleProxyRequestLogger(): ProxyRequestLogger {
  return {
    log(event) {
      try {
        console.log(formatConsoleLogLine(event));
      } catch (error) {
        warnLoggerFailure("console", error);
      }
    },
    close() {},
  };
}

function createCompositeProxyRequestLogger(
  loggers: ProxyRequestLogger[],
): ProxyRequestLogger {
  return {
    log(event) {
      for (const logger of loggers) {
        logger.log(event);
      }
    },
    close() {
      for (const logger of loggers) {
        logger.close();
      }
    },
  };
}

function createSqliteProxyRequestLogger(path: string): ProxyRequestLogger {
  const database = new Database(path, { create: true, strict: true });
  database.exec(
    `CREATE TABLE IF NOT EXISTS proxy_request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      request_type TEXT NOT NULL,
      destination_host TEXT NOT NULL,
      destination_port INTEGER NOT NULL,
      relay_hostname TEXT NOT NULL
    )`,
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_proxy_request_logs_timestamp ON proxy_request_logs (timestamp)",
  );
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_proxy_request_logs_destination_host ON proxy_request_logs (destination_host)",
  );

  const insertStatement = database.prepare(
    `INSERT INTO proxy_request_logs (
      timestamp,
      request_type,
      destination_host,
      destination_port,
      relay_hostname
    ) VALUES (?, ?, ?, ?, ?)`,
  );

  return createSqliteProxyRequestLoggerFromStatement(insertStatement, database);
}

export function createSqliteProxyRequestLoggerFromStatement(
  statement: StatementLike,
  closable?: { close(): void },
): ProxyRequestLogger {
  return {
    log(event) {
      try {
        statement.run(
          event.timestamp,
          event.requestType,
          event.destinationHost,
          event.destinationPort,
          event.relayHostname,
        );
      } catch (error) {
        warnLoggerFailure("sqlite", error);
      }
    },
    close() {
      closable?.close();
    },
  };
}

function formatConsoleLogLine(event: ProxyRequestLogEvent): string {
  return `[proxy-log] ${event.timestamp} type=${event.requestType} dest=${event.destinationHost}:${event.destinationPort} relay=${event.relayHostname}`;
}

function warnLoggerFailure(target: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Unknown logger failure";
  console.error(`[proxy-log] Failed to write ${target} log: ${message}`);
}
