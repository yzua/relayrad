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
  country?: string | undefined;
  city?: string | undefined;
  hostname?: string | undefined;
  provider?: string | undefined;
  ownership?: RelayOwnership | undefined;
  excludeCountry?: string[] | undefined;
}

export type RelaySort = "random" | "hostname" | "country" | "city";

export interface RelaySelectionConfig extends RelayFilters {
  sort?: RelaySort | undefined;
  unhealthyBackoffMs?: number | undefined;
}
