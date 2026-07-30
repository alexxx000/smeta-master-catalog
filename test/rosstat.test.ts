import { describe, expect, it } from "vitest";

import {
  discoverRosstatWorkbook,
  normalizeUnit,
  parseWorkbookPeriod,
} from "../src/rosstat.js";

describe("источник Росстата", () => {
  it("находит именно XLSX средних цен строительных организаций", () => {
    const html = `
      <div class="document-list__item">
        <a href="/storage/mediabank/Materialy_index_05-2026.xlsx">XLSX</a>
        <div class="document-list__item-title">Индексы цен на приобретенные строительными организациями</div>
      </div>
      <div class="document-list__item">
        <a href="/storage/mediabank/Materialy_cena_05-2026.xlsx">XLSX</a>
        <div class="document-list__item-title">Средние цены на приобретенные строительными организациями основные материалы, детали и конструкции (с 1996 г.)</div>
      </div>`;

    expect(discoverRosstatWorkbook(html)).toBe(
      "https://rosstat.gov.ru/storage/mediabank/Materialy_cena_05-2026.xlsx",
    );
  });

  it("отклоняет страницу без нужного набора", () => {
    expect(() => discoverRosstatWorkbook("<html></html>")).toThrow(/Росстат/);
  });

  it("получает период из имени файла", () => {
    expect(parseWorkbookPeriod("https://x/Materialy_cena_05-2026.xlsx")).toBe("2026-05");
  });

  it("нормализует только явно разрешённые единицы", () => {
    expect(normalizeUnit("м3")).toBe("м³");
    expect(normalizeUnit("м2")).toBe("м²");
    expect(normalizeUnit("шт")).toBe("шт");
    expect(() => normalizeUnit("т")).toThrow(/единиц/);
  });
});
