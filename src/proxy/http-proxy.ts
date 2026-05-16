import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogEvent } from "../logging/proxy-request-logger";
import { relayHttpRequest } from "./relay-http-request";
import {
  createRetryDeps,
  type ProxyRuntime,
  parseStickySessionHeader,
  tryRelays,
} from "./relay-retry";

export async function handleHttpProxyRequest(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  runtime: ProxyRuntime,
): Promise<void> {
  const targetUrl = parseProxyTarget(clientRequest.url);
  const sessionKey = parseStickySessionHeader(
    clientRequest.headers["x-proxy-session"],
  );
  if (
    !targetUrl ||
    (targetUrl.protocol !== "http:" && targetUrl.protocol !== "ws:")
  ) {
    clientResponse.writeHead(400, { "content-type": "application/json" });
    clientResponse.end(
      JSON.stringify({
        error: "Proxy requests must use an absolute http:// or ws:// URL",
      }),
    );
    return;
  }

  const headers = { ...clientRequest.headers };
  delete headers["proxy-connection"];
  headers.host = targetUrl.host;
  headers.connection = "close";

  const retryDeps = createRetryDeps(runtime, sessionKey);

  const lastError = await tryRelays(retryDeps, async (relay) => {
    await relayHttpRequest(
      relay,
      clientRequest.method ?? "GET",
      targetUrl,
      headers,
      clientRequest,
      clientResponse,
      sessionKey,
      () =>
        runtime.requestLogger.log(
          createLogEvent(
            "http",
            targetUrl.hostname,
            Number(targetUrl.port || 80),
            relay,
          ),
        ),
    );
  });

  if (lastError) {
    if (!clientResponse.headersSent) {
      clientResponse.writeHead(502, { "content-type": "application/json" });
      clientResponse.end(JSON.stringify({ error: lastError.message }));
    }
  }
}

function parseProxyTarget(url: string | undefined): URL | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
