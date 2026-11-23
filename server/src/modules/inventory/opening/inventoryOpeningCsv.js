import { CsvError, parse } from "csv-parse/sync";
import { INVENTORY_STOCK_STATUSES } from "../inventoryConstants.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5_000;
const HEADER = ["warehouseCode", "binCode", "skuCode", "lotNumber", "expiryDate", "stockStatus", "baseQuantity"];

function rejected(row, field, code) {
  return { rows: [], skippedRows: [], errors: [{ row, field, code }] };
}

export function parseInventoryOpeningCsv(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError("Opening CSV requires file bytes");
  if (bytes.length > MAX_BYTES) return rejected(1, "file", "OPENING_CSV_TOO_LARGE");

  let csv;
  try {
    csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return rejected(1, "file", "OPENING_CSV_INVALID_UTF8");
  }

  let records;
  try {
    // Read the header and one row beyond the limit to detect oversized input.
    records = parse(csv, { relax_column_count: true, to: MAX_ROWS + 2 });
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    return rejected((error.records ?? 0) + 1, "row", "OPENING_CSV_MALFORMED");
  }

  const [header, ...data] = records;
  if (header?.length !== HEADER.length || !HEADER.every((field, index) => header[index] === field)) {
    return rejected(1, "header", "OPENING_CSV_INVALID_HEADER");
  }
  if (data.length > MAX_ROWS) return rejected(MAX_ROWS + 2, "file", "OPENING_CSV_TOO_MANY_ROWS");

  const rows = [];
  const skippedRows = [];
  const errors = [];
  for (const [index, record] of data.entries()) {
    const row = index + 2;
    if (record.length !== HEADER.length) {
      errors.push({ row, field: "row", code: "OPENING_CSV_COLUMN_COUNT" });
      continue;
    }

    const [warehouseCode, binCode, skuCode, lotNumber, expiryDate, stockStatus, quantity] =
      record.map(cell => cell.trim());
    const baseQuantity = Number(quantity);
    const priorErrorCount = errors.length;

    for (const [column, cell] of record.slice(0, -1).entries()) {
      const value = cell.trim();
      if (/\p{Cc}/u.test(cell) || /^[=+\-@]/u.test(value) || (column < 3 && !value) ||
          (HEADER[column] === "stockStatus" && !INVENTORY_STOCK_STATUSES.includes(value))) {
        errors.push({ row, field: HEADER[column], code: "OPENING_CSV_INVALID_FIELD" });
      }
    }
    if (!/^\d+$/u.test(quantity) || !Number.isSafeInteger(baseQuantity) || /\p{Cc}/u.test(record[6])) {
      errors.push({ row, field: "baseQuantity", code: "OPENING_CSV_INVALID_QUANTITY" });
    }
    if (errors.length !== priorErrorCount) continue;
    if (baseQuantity === 0) skippedRows.push(row);
    else rows.push({ row, warehouseCode, binCode, skuCode, lotNumber, expiryDate, stockStatus, baseQuantity });
  }
  return { rows: errors.length ? [] : rows, skippedRows, errors };
}
