import type { RelaySelectionConfig } from "./relay-types";

export const defaultSelectionConfig: RelaySelectionConfig = {
  sort: "hostname",
  unhealthyBackoffMs: 30_000,
};
