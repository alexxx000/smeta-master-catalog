import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

import type { CatalogPeriod } from "./types.js";

export const EMISS_CSV_URL =
  "https://storage.yandexcloud.net/datalakeiepru-s3-storage-public/fedstatru/csv/37055.csv.gz";

export interface EmissSnapshot {
  sourceUrl: string;
  fetchedAt: string;
  latestPeriod: CatalogPeriod;
  records: Record<string, string>[];
}

const MONTHS: Record<string, string> = {
  январь: "01",
  февраль: "02",
  март: "03",
  апрель: "04",
  май: "05",
  июнь: "06",
  июль: "07",
  август: "08",
  сентябрь: "09",
  октябрь: "10",
  ноябрь: "11",
  декабрь: "12",
};

export async function fetchEmiss(): Promise<EmissSnapshot> {
  const bytes = process.env.EMISS_CSV_FILE
    ? await readFile(process.env.EMISS_CSV_FILE)
    : await fetch(EMISS_CSV_URL, {
        headers: { "user-agent": "smeta-master-catalog/1.0" },
      }).then(async (response) => {
        if (!response.ok) throw new Error(`ЕМИСС/НЦСЭД: CSV вернул HTTP ${response.status}`);
        return Buffer.from(await response.arrayBuffer());
      });
  const csv = gunzipSync(bytes).toString("utf8").replace(/\r\r\n/g, "\r\n");
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];
  if (!records.length) throw new Error("ЕМИСС/НЦСЭД: CSV пуст");
  const years = Object.keys(records[0])
    .filter((key) => /^20\d{2}$/.test(key))
    .map(Number);
  const year = Math.max(...years);
  const availableMonths = records
    .filter((record) => Number(record[String(year)]) > 0)
    .map((record) => {
      const label = record.Период?.replace(/^\d+\s+/, "").trim().toLocaleLowerCase("ru");
      return MONTHS[label] ?? "";
    })
    .filter(Boolean)
    .sort();
  if (!availableMonths.length) throw new Error("ЕМИСС/НЦСЭД: актуальный период не найден");
  return {
    sourceUrl: EMISS_CSV_URL,
    fetchedAt: new Date().toISOString(),
    latestPeriod: `${year}-${availableMonths.at(-1)}` as CatalogPeriod,
    records,
  };
}
