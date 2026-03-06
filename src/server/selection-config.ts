import type { IncomingMessage } from "node:http";
import type { RelaySelectionConfig } from "../relay/relay-types";

export function selectionConfigFromUrl(url: URL): RelaySelectionConfig {
  return sanitizeSelectionConfig(
    Object.fromEntries(url.searchParams.entries()),
  );
}

export function sanitizeSelectionConfig(input: unknown): RelaySelectionConfig {
  const value = isRecord(input) ? input : {};
  return {
    country: stringField(value.country),
    city: stringField(value.city),
    hostname: stringField(value.hostname),
    provider: stringField(value.provider),
    ownership: ownershipField(value.ownership),
    sort: sortField(value.sort),
    unhealthyBackoffMs: numberField(value.unhealthyBackoffMs),
  };
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function ownershipField(value: unknown): RelaySelectionConfig["ownership"] {
  return value === "owned" || value === "rented" ? value : undefined;
}

function sortField(value: unknown): RelaySelectionConfig["sort"] {
  return value === "country" ||
    value === "city" ||
    value === "hostname" ||
    value === "random"
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
