const expectedHeaderCache = new WeakMap<
  { username: string; password: string },
  string
>();

export function checkProxyAuthRaw(
  header: string | undefined,
  expected: { username: string; password: string },
): boolean {
  if (!header || !header.startsWith("Basic ")) {
    return false;
  }

  let expectedHeader = expectedHeaderCache.get(expected);
  if (!expectedHeader) {
    expectedHeader = `Basic ${Buffer.from(`${expected.username}:${expected.password}`).toString("base64")}`;
    expectedHeaderCache.set(expected, expectedHeader);
  }

  return header === expectedHeader;
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
