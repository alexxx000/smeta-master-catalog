export type CatalogPeriod = `${number}-${string}`;
export type CatalogVersion = `${CatalogPeriod}-r${number}`;
export type Unit = "шт" | "м" | "м²" | "м³" | "час" | "день" | "комплект" | "услуга";
export type PriceSourceCode = "rosstat" | "emiss" | "fgiscs" | "manual";

export interface BaseItem {
  id: string;
  name: string;
  category: string;
  unit: Unit;
  price: number;
  brand?: string;
  note?: string;
  dateUpdated?: string;
}

export interface PriceSource {
  code: PriceSourceCode;
  title: string;
  url: string;
  license: string;
  fetchedAt: string;
  datasetVersion: string;
}

export interface OfficialPrice {
  itemId: string;
  handbookKey?: string;
  region: string;
  price: number;
  period: string;
  sourceCode: PriceSourceCode;
  unit: Unit;
}

export interface CatalogReleaseManifestV1 {
  schemaVersion: 1;
  catalogPeriod: CatalogPeriod;
  catalogVersion: CatalogVersion;
  publishedAt: string;
  sourcePeriods: Record<string, string>;
  displayPriceRub: 50;
  assetUrl: string;
  releasePageUrl: string;
  compressedBytes: number;
  sha256: string;
  itemCount: number;
  referenceCount: number;
  regions: string[];
  sources: PriceSource[];
}

export interface CatalogPackageV1 {
  manifest: CatalogReleaseManifestV1;
  items: BaseItem[];
  references: OfficialPrice[];
}

export interface RosstatRow {
  code: string;
  name: string;
  unit: string;
  price: number;
  period: CatalogPeriod;
}

export interface CatalogMapping {
  sourceCode: PriceSourceCode;
  sourceItemCode: string;
  itemId: string;
  handbookKey?: string;
  expectedUnit: Unit;
  aliases: string[];
}
