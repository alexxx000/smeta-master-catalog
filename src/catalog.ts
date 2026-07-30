import { createHash } from "node:crypto";

import type {
  BaseItem,
  CatalogPackageV1,
  CatalogPeriod,
  CatalogVersion,
  OfficialPrice,
  PriceSource,
} from "./types.js";

const PERIOD = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const VERSION = /^(20\d{2})-(0[1-9]|1[0-2])-r([1-9]\d*)$/;

function fail(message: string): never {
  throw new Error(`Каталог: ${message}`);
}

function sha256Payload(items: BaseItem[], references: OfficialPrice[]): string {
  // Хешируется полезная нагрузка без манифеста, чтобы избежать самоссылки sha256.
  return createHash("sha256").update(JSON.stringify({ items, references })).digest("hex");
}

export function assertCoverage(current: number, previous: number, minimumRatio = 0.7): void {
  if (previous > 0 && current / previous < minimumRatio) {
    fail(`покрытие резко упало: ${current} вместо ${previous}`);
  }
}

export function nextRevision(
  previousVersion: CatalogVersion | undefined,
  period: CatalogPeriod,
): number {
  if (!PERIOD.test(period)) fail(`неверный период ${period}`);
  if (!previousVersion) return 1;
  const match = VERSION.exec(previousVersion);
  if (!match) fail(`неверная предыдущая версия ${previousVersion}`);
  return `${match[1]}-${match[2]}` === period ? Number(match[3]) + 1 : 1;
}

export function buildCatalogPackage(input: {
  items: BaseItem[];
  prices: OfficialPrice[];
  period: CatalogPeriod;
  revision: number;
  publishedAt: string;
  repository: string;
  compressedBytes?: number;
  sources?: PriceSource[];
}): CatalogPackageV1 {
  const { items, prices, period, revision, publishedAt, repository } = input;
  if (!PERIOD.test(period)) fail(`неверный период ${period}`);
  if (!Number.isInteger(revision) || revision < 1) fail("ревизия должна быть положительной");
  const catalogVersion = `${period}-r${revision}` as CatalogVersion;
  const tag = `catalog-${catalogVersion}`;
  const sources: PriceSource[] =
    input.sources ??
    [
      {
        code: "rosstat",
        title: "Росстат: средние цены на приобретённые строительные материалы (9-КС)",
        url: "https://rosstat.gov.ru/statistics/price",
        license: "Открытые данные Росстата",
        fetchedAt: publishedAt,
        datasetVersion: `rosstat-9ks-${period}`,
      },
    ];
  const regions = [...new Set(prices.map((price) => price.region))].sort();
  const sourcePeriods = Object.fromEntries(
    [...new Set(prices.map((price) => price.sourceCode))].map((code) => [
      code,
      prices
        .filter((price) => price.sourceCode === code)
        .map((price) => price.period)
        .sort()
        .at(-1)!,
    ]),
  );
  const pkg: CatalogPackageV1 = {
    manifest: {
      schemaVersion: 1,
      catalogPeriod: period,
      catalogVersion,
      publishedAt,
      sourcePeriods,
      displayPriceRub: 50,
      assetUrl: `https://github.com/${repository}/releases/download/${tag}/catalog-${catalogVersion}.json.gz`,
      releasePageUrl: `https://github.com/${repository}/releases/tag/${tag}`,
      compressedBytes: input.compressedBytes ?? 1,
      sha256: sha256Payload(items, prices),
      itemCount: items.length,
      referenceCount: prices.length,
      regions,
      sources,
    },
    items,
    references: prices,
  };
  return validatePackage(pkg);
}

export function validatePackage(pkg: CatalogPackageV1): CatalogPackageV1 {
  const { manifest, items, references } = pkg;
  if (manifest.schemaVersion !== 1) fail("неподдерживаемая schemaVersion");
  if (!PERIOD.test(manifest.catalogPeriod) || !VERSION.test(manifest.catalogVersion)) {
    fail("неверная версия");
  }
  if (!manifest.catalogVersion.startsWith(`${manifest.catalogPeriod}-r`)) {
    fail("период и версия не согласованы");
  }
  if (!Number.isFinite(Date.parse(manifest.publishedAt))) fail("неверная дата публикации");
  if (manifest.displayPriceRub !== 50) fail("неверная отображаемая цена");
  if (manifest.compressedBytes < 1 || manifest.compressedBytes > 50 * 1024 * 1024) {
    fail("недопустимый размер пакета");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) fail("неверный SHA-256");
  if (manifest.itemCount !== items.length || manifest.referenceCount !== references.length) {
    fail("счётчики не совпадают");
  }
  const sourceCodes = new Set(manifest.sources.map((source) => source.code));
  const itemIds = new Set<string>();
  for (const item of items) {
    if (!item.id || itemIds.has(item.id)) fail(`дубликат item id ${item.id}`);
    if (!Number.isFinite(item.price) || item.price <= 0) fail(`неверная цена товара ${item.id}`);
    itemIds.add(item.id);
  }
  const referenceKeys = new Set<string>();
  for (const reference of references) {
    if (!itemIds.has(reference.itemId)) fail(`неизвестный itemId ${reference.itemId}`);
    if (!Number.isFinite(reference.price) || reference.price <= 0) {
      fail(`неверная цена ориентира ${reference.itemId}`);
    }
    if (!sourceCodes.has(reference.sourceCode)) fail(`неизвестный источник ${reference.sourceCode}`);
    if (!PERIOD.test(reference.period) || reference.period > manifest.catalogPeriod) {
      fail(`неверный период ориентира ${reference.itemId}`);
    }
    const key = `${reference.itemId}|${reference.region}`;
    if (referenceKeys.has(key)) fail(`дубликат ориентира ${key}`);
    referenceKeys.add(key);
  }
  if (sha256Payload(items, references) !== manifest.sha256) fail("SHA-256 содержимого не совпадает");
  return pkg;
}
