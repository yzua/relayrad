export type RelayOwnership = "owned" | "rented";
export type RelaySource = "mullvad" | "tor" | "nordvpn";

export interface RelayRecord {
  source: RelaySource;
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
  socks5Username?: string | undefined;
  socks5Password?: string | undefined;
  socks5UniqueAuth?: boolean | undefined;
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
