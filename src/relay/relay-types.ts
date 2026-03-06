export type RelayOwnership = "owned" | "rented";

export interface RelayRecord {
  countryName: string;
  countryCode: string;
  cityName: string;
  cityCode: string;
  hostname: string;
  ipv4: string;
  ipv6: string;
  protocol: string;
  provider: string;
  ownership: RelayOwnership;
  socks5Hostname: string;
  socks5Port: number;
}

export interface RelayFilters {
  country?: string;
  city?: string;
  hostname?: string;
  provider?: string;
  ownership?: RelayOwnership;
}

export type RelaySort = "random" | "hostname" | "country" | "city";

export interface RelaySelectionConfig extends RelayFilters {
  sort?: RelaySort;
  unhealthyBackoffMs?: number;
}
