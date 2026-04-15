export function checkProxyAuthRaw(
  header: string | undefined,
  expected: { username: string; password: string },
): boolean {
  if (!header || !header.startsWith("Basic ")) {
    return false;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return false;
  }

  return (
    decoded.slice(0, separator) === expected.username &&
    decoded.slice(separator + 1) === expected.password
  );
}

export function sendProxyAuthRequired(
  res: import("node:http").ServerResponse,
): void {
  res.writeHead(407, {
    "proxy-authenticate": 'Basic realm="relayrad"',
    "content-type": "application/json",
  });
  res.end(JSON.stringify({ error: "Proxy authentication required" }));
}
