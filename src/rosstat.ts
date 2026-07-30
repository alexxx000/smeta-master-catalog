import * as cheerio from "cheerio";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

import type { CatalogPeriod, RosstatRow, Unit } from "./types.js";

const ROSSTAT_ORIGIN = "https://rosstat.gov.ru";
const TARGET_TITLE =
  "средние цены на приобретенные строительными организациями основные материалы";

export function discoverRosstatWorkbook(html: string): string {
  const $ = cheerio.load(html);
  for (const element of $(".document-list__item").toArray()) {
    const node = $(element);
    const title = node.find(".document-list__item-title").text().replace(/\s+/g, " ").trim();
    const href = node.find("a[href$='.xlsx']").attr("href");
    if (href && title.toLocaleLowerCase("ru").includes(TARGET_TITLE)) {
      return new URL(href, ROSSTAT_ORIGIN).toString();
    }
  }
  throw new Error("Росстат: не найден XLSX средних цен строительных организаций");
}

export function parseWorkbookPeriod(url: string): CatalogPeriod {
  const match = /_(0[1-9]|1[0-2])-(20\d{2})\.xlsx(?:$|\?)/i.exec(url);
  if (!match) throw new Error("Росстат: период не найден в имени XLSX");
  return `${match[2]}-${match[1]}` as CatalogPeriod;
}

export function normalizeUnit(value: string): Unit {
  const normalized = value.trim().toLocaleLowerCase("ru").replace(/\s+/g, "");
  const units: Record<string, Unit> = {
    шт: "шт",
    м: "м",
    м2: "м²",
    "м²": "м²",
    м3: "м³",
    "м³": "м³",
    компл: "комплект",
    комплект: "комплект",
  };
  const unit = units[normalized];
  if (!unit) throw new Error(`Росстат: неизвестная единица измерения «${value}»`);
  return unit;
}

function splitNameAndUnit(raw: string): { name: string; unit: string } {
  const index = raw.lastIndexOf(",");
  if (index < 1) throw new Error(`Росстат: единица отсутствует в строке «${raw}»`);
  return {
    name: raw.slice(0, index).replace(/\s+/g, " ").trim(),
    unit: raw.slice(index + 1).trim(),
  };
}

function monthColumn(period: CatalogPeriod): number {
  return Number(period.slice(5, 7)) + 1;
}

export function parseRosstatWorkbook(bytes: Uint8Array, period: CatalogPeriod): RosstatRow[] {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const year = Number(period.slice(0, 4));
  const candidateNames = workbook.SheetNames.filter((name) => /^\d+$/.test(name));
  if (!candidateNames.length) throw new Error("Росстат: в XLSX нет листов с данными");

  // В книге листы с 2019 года идут по порядку: 3=2020 ... 8=2026.
  const expectedSheet = String(year - 2018);
  const sheetName = workbook.Sheets[expectedSheet]
    ? expectedSheet
    : candidateNames.sort((a, b) => Number(b) - Number(a))[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const column = monthColumn(period);
  const output: RosstatRow[] = [];

  for (const row of rows.slice(4)) {
    const rawName = typeof row[0] === "string" ? row[0].trim() : "";
    const code = typeof row[1] === "string" ? row[1].trim() : String(row[1] ?? "").trim();
    const value = Number(row[column]);
    if (!rawName || !code || !Number.isFinite(value) || value <= 0) continue;
    const { name, unit } = splitNameAndUnit(rawName);
    output.push({ code, name, unit, price: value, period });
  }
  if (!output.length) throw new Error(`Росстат: нет цен за ${period}`);
  return output;
}

export async function fetchRosstat(): Promise<{
  workbookUrl: string;
  period: CatalogPeriod;
  rows: RosstatRow[];
  fetchedAt: string;
}> {
  const pageHtml = process.env.ROSSTAT_PAGE_FILE
    ? await readFile(process.env.ROSSTAT_PAGE_FILE, "utf8")
    : await fetch(`${ROSSTAT_ORIGIN}/statistics/price`, {
        headers: { "user-agent": "smeta-master-catalog/1.0" },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Росстат: страница вернула HTTP ${response.status}`);
        return response.text();
      });
  const workbookUrl = discoverRosstatWorkbook(pageHtml);
  const workbookBytes = process.env.ROSSTAT_WORKBOOK_FILE
    ? new Uint8Array(await readFile(process.env.ROSSTAT_WORKBOOK_FILE))
    : await fetch(workbookUrl, {
        headers: { "user-agent": "smeta-master-catalog/1.0" },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Росстат: XLSX вернул HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      });
  const period = parseWorkbookPeriod(workbookUrl);
  return {
    workbookUrl,
    period,
    rows: parseRosstatWorkbook(workbookBytes, period),
    fetchedAt: new Date().toISOString(),
  };
}
