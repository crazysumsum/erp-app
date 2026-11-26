import { stringify } from "csv-stringify/sync";

const VALUES = ["currencyCode", "invoiceCount", "notDue", "days1To30", "days31To60", "days61To90", "over90", "total"];

export function agingCsv({ asOfDate, items, totals }, party) {
  const partyColumns = [party + "Code", party + "Name"];
  const project = (row, rowType) => [asOfDate, rowType, ...partyColumns.map((key) => row[key] ?? ""), ...VALUES.map((key) => row[key])];
  return stringify([
    ["asOfDate", "rowType", ...partyColumns, ...VALUES],
    ...items.map((item) => project(item, "detail")),
    ...totals.map((total) => project(total, "currencyTotal"))
  ], { bom: true, escape_formulas: true, record_delimiter: "windows" });
}
