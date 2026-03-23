export function parsePortValue(
  value: string | undefined,
  errorPrefix = "Invalid port",
): number | undefined {
  if (!value) {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${errorPrefix}: ${value}`);
  }

  return port;
}

export function validatePortInput(value: string): true | string {
  try {
    parsePortValue(value);
    return true;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid port";
  }
}

export function parseProxyAuthValue(
  value: string | undefined,
): { username: string; password: string } | undefined {
  if (!value) {
    return undefined;
  }

  const separator = value.indexOf(":");
  if (separator <= 0) {
    throw new Error("Invalid --proxy-auth format (expected user:pass)");
  }

  return {
    username: value.slice(0, separator),
    password: value.slice(separator + 1),
  };
}

export function validateProxyAuthInput(value: string): true | string {
  if (!value) {
    return "Format: user:pass";
  }

  try {
    parseProxyAuthValue(value);
    return true;
  } catch {
    return "Format: user:pass";
  }
}
