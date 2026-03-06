import type { RelaySelectionConfig } from "../relay/relay-types";

export const defaultSelectionConfig: RelaySelectionConfig = {
  sort: "random",
  unhealthyBackoffMs: 30_000,
};
