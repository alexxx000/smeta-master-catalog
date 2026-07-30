import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

import { assertCoverage, buildCatalogPackage, nextRevision, validatePackage } from "./catalog.js";
import { fetchEmiss } from "./emiss.js";
import { fetchRosstat, normalizeUnit } from "./rosstat.js";
import type {
  BaseItem,
  CatalogMapping,
  CatalogPackageV1,
  CatalogPeriod,
  CatalogReleaseManifestV1,
  OfficialPrice,
  PriceSource,
} from "./types.js";

const repository = process.env.GITHUB_REPOSITORY ?? "alexxx000/smeta-master-catalog";
const releasePeriod = (process.env.RELEASE_PERIOD ??
  new Date().toISOString().slice(0, 7)) as CatalogPeriod;
const outputDirectory = process.env.CATALOG_OUTPUT_DIR ?? "dist/catalog";

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
}

async function optionalLatest(): Promise<CatalogReleaseManifestV1 | undefined> {
  try {
    return JSON.parse(await readFile("latest.json", "utf8")) as CatalogReleaseManifestV1;
  } catch {
    return undefined;
  }
}

function finalizeCompressedSize(pkg: CatalogPackageV1): {
  pkg: CatalogPackageV1;
  compressed: Buffer;
} {
  let compressed = Buffer.alloc(0);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    compressed = gzipSync(JSON.stringify(pkg), { level: 9 });
    if (pkg.manifest.compressedBytes === compressed.byteLength) return { pkg, compressed };
    pkg.manifest.compressedBytes = compressed.byteLength;
  }
  compressed = gzipSync(JSON.stringify(pkg), { level: 9 });
  pkg.manifest.compressedBytes = compressed.byteLength;
  return { pkg, compressed: gzipSync(JSON.stringify(pkg), { level: 9 }) };
}

async function main(): Promise<void> {
  const [baseFile, mappingsFile, rosstat, previous, emiss] = await Promise.all([
    readFile("data/base-items.json", "utf8"),
    readFile("data/mappings.json", "utf8"),
    fetchRosstat(),
    optionalLatest(),
    fetchEmiss(),
  ]);
  const base = JSON.parse(baseFile) as { items: BaseItem[] };
  const mappings = JSON.parse(mappingsFile) as CatalogMapping[];
  const rowsByCode = new Map(rosstat.rows.map((row) => [row.code, row]));
  const items = [...base.items];
  const itemIds = new Set(items.map((item) => item.id));
  const prices: OfficialPrice[] = [];

  for (const mapping of mappings.filter((entry) => entry.sourceCode === "rosstat")) {
    const row = rowsByCode.get(mapping.sourceItemCode);
    if (!row) throw new Error(`Росстат: обязательный код ${mapping.sourceItemCode} отсутствует`);
    const unit = normalizeUnit(row.unit);
    if (unit !== mapping.expectedUnit) {
      throw new Error(
        `Росстат: единица ${mapping.sourceItemCode} изменилась: ${unit} вместо ${mapping.expectedUnit}`,
      );
    }
    if (!mapping.aliases.map(normalized).includes(normalized(row.name))) {
      throw new Error(`Росстат: название ${mapping.sourceItemCode} не входит в явные aliases`);
    }
    if (!itemIds.has(mapping.itemId)) {
      items.push({
        id: mapping.itemId,
        name: row.name,
        category: "Официальные ориентиры",
        unit,
        price: Math.round(row.price),
        note: `Средняя цена Росстата 9-КС, ${row.period}`,
        dateUpdated: row.period,
      });
      itemIds.add(mapping.itemId);
    }
    prices.push({
      itemId: mapping.itemId,
      handbookKey: mapping.handbookKey,
      region: "РФ",
      price: row.price,
      period: row.period,
      sourceCode: "rosstat",
      unit,
    });
  }

  // Набор ЕМИСС используется только для отсутствующих позиций и только если он свежее Росстата.
  // Текущий открытый набор 37055 исторический; поэтому при старом периоде он корректно не влияет.
  const emissIsFresher = emiss.latestPeriod > rosstat.period;
  const sources: PriceSource[] = [
    {
      code: "rosstat",
      title: "Росстат: средние цены на приобретённые строительные материалы (9-КС)",
      url: rosstat.workbookUrl,
      license: "Открытые данные Росстата",
      fetchedAt: rosstat.fetchedAt,
      datasetVersion: `rosstat-9ks-${rosstat.period}`,
    },
  ];
  if (emissIsFresher && prices.some((price) => price.sourceCode === "emiss")) {
    sources.push({
      code: "emiss",
      title: "ЕМИСС / НЦСЭД: средние потребительские цены",
      url: emiss.sourceUrl,
      license: "CC-BY 4.0",
      fetchedAt: emiss.fetchedAt,
      datasetVersion: `emiss-37055-${emiss.latestPeriod}`,
    });
  }

  const previousCoverage = previous?.referenceCount ?? 0;
  assertCoverage(prices.length, previousCoverage, 0.7);
  const revision = nextRevision(previous?.catalogVersion, releasePeriod);
  const pkg = buildCatalogPackage({
    items,
    prices,
    period: releasePeriod,
    revision,
    publishedAt: new Date().toISOString(),
    repository,
    sources,
  });
  pkg.manifest.sourcePeriods = { rosstat: rosstat.period };
  validatePackage(pkg);
  const finalized = finalizeCompressedSize(pkg);
  validatePackage(finalized.pkg);

  await mkdir(outputDirectory, { recursive: true });
  const filename = `catalog-${finalized.pkg.manifest.catalogVersion}.json.gz`;
  await Promise.all([
    writeFile(`${outputDirectory}/${filename}`, finalized.compressed),
    writeFile(`${outputDirectory}/latest.json`, `${JSON.stringify(finalized.pkg.manifest, null, 2)}\n`),
    writeFile(`${outputDirectory}/catalog.json`, `${JSON.stringify(finalized.pkg, null, 2)}\n`),
  ]);
  console.log(
    JSON.stringify({
      filename,
      catalogVersion: finalized.pkg.manifest.catalogVersion,
      itemCount: finalized.pkg.manifest.itemCount,
      referenceCount: finalized.pkg.manifest.referenceCount,
      regions: finalized.pkg.manifest.regions,
      compressedBytes: finalized.pkg.manifest.compressedBytes,
      rosstatPeriod: rosstat.period,
      emissPeriod: emiss.latestPeriod,
      emissApplied: emissIsFresher && prices.some((price) => price.sourceCode === "emiss"),
    }),
  );
}

await main();
