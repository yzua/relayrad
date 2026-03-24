import type { IncomingMessage } from "node:http";
import type { RelaySelectionConfig } from "../relay/relay-types";

const MAX_REQUEST_BODY_BYTES = 1024 * 64;

const KNOWN_ROTATE_FIELDS = new Set([
  "country",
  "city",
  "hostname",
  "provider",
  "ownership",
  "exclude_country",
  "sort",
  "unhealthyBackoffMs",
]);

export class InvalidJsonBodyError extends Error {
  constructor(message = "Request body must be valid JSON") {
    super(message);
    this.name = "InvalidJsonBodyError";
  }
}

export function selectionConfigFromUrl(url: URL): RelaySelectionConfig {
  return sanitizeSelectionConfig(
    Object.fromEntries(url.searchParams.entries()),
  );
}

export function sanitizeSelectionConfig(input: unknown): RelaySelectionConfig {
  const value = isRecord(input) ? input : {};
  return {
    country: stringField(value["country"]),
    city: stringField(value["city"]),
    hostname: stringField(value["hostname"]),
    provider: stringField(value["provider"]),
    ownership: ownershipField(value["ownership"]),
    excludeCountry: stringListField(value["exclude_country"]),
    sort: sortField(value["sort"]),
    unhealthyBackoffMs: numberField(value["unhealthyBackoffMs"]),
  };
}

export function unknownFields(input: unknown): string[] {
  if (!isRecord(input)) return [];
  return Object.keys(input).filter((key) => !KNOWN_ROTATE_FIELDS.has(key));
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;

    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new InvalidJsonBodyError(
        `Request body exceeds ${MAX_REQUEST_BODY_BYTES} byte limit`,
      );
    }

    chunks.push(buf);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringListField(value: unknown): string[] | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function ownershipField(value: unknown): RelaySelectionConfig["ownership"] {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  return lower === "owned" || lower === "rented" ? lower : undefined;
}

function sortField(value: unknown): RelaySelectionConfig["sort"] {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  return lower === "country" ||
    lower === "city" ||
    lower === "hostname" ||
    lower === "random"
    ? lower
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
