import { describe, expect, it } from "vitest";

import {
  assertCoverage,
  buildCatalogPackage,
  nextRevision,
  validatePackage,
} from "../src/catalog.js";
import type { BaseItem, OfficialPrice } from "../src/types.js";

const items: BaseItem[] = [
  { id: "sand", name: "Песок", category: "Строительные материалы", unit: "м³", price: 500 },
  { id: "gravel", name: "Щебень", category: "Строительные материалы", unit: "м³", price: 2500 },
];

const prices: OfficialPrice[] = [
  {
    itemId: "sand",
    handbookKey: "строительные материалы|materials|песок",
    region: "РФ",
    price: 888.74,
    period: "2026-05",
    sourceCode: "rosstat",
    unit: "м³",
  },
];

describe("сборка выпуска", () => {
  it("создаёт согласованный пакет v1", () => {
    const pkg = buildCatalogPackage({
      items,
      prices,
      period: "2026-05",
      revision: 1,
      publishedAt: "2026-07-30T00:00:00.000Z",
      repository: "alexxx000/smeta-master-catalog",
    });
    expect(pkg.manifest.catalogVersion).toBe("2026-05-r1");
    expect(pkg.manifest.itemCount).toBe(2);
    expect(pkg.manifest.referenceCount).toBe(1);
    expect(validatePackage(pkg)).toBe(pkg);
  });

  it("отклоняет дубликаты, отрицательные цены и неизвестные ссылки", () => {
    const duplicate = [...prices, prices[0]];
    expect(() =>
      buildCatalogPackage({
        items,
        prices: duplicate,
        period: "2026-05",
        revision: 1,
        publishedAt: "2026-07-30T00:00:00.000Z",
        repository: "alexxx000/smeta-master-catalog",
      }),
    ).toThrow(/дубликат/i);

    expect(() =>
      buildCatalogPackage({
        items,
        prices: [{ ...prices[0], price: -1 }],
        period: "2026-05",
        revision: 1,
        publishedAt: "2026-07-30T00:00:00.000Z",
        repository: "alexxx000/smeta-master-catalog",
      }),
    ).toThrow(/цен/i);
  });

  it("останавливает публикацию при резком падении покрытия", () => {
    expect(() => assertCoverage(69, 100, 0.7)).toThrow(/покрыт/i);
    expect(() => assertCoverage(70, 100, 0.7)).not.toThrow();
  });

  it("увеличивает ревизию в том же месяце и начинает r1 в новом", () => {
    expect(nextRevision(undefined, "2026-05")).toBe(1);
    expect(nextRevision("2026-05-r2", "2026-05")).toBe(3);
    expect(nextRevision("2026-04-r8", "2026-05")).toBe(1);
  });
});
