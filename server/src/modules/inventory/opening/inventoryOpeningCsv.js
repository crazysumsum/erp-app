import { CsvError, parse } from "csv-parse/sync";
import { INVENTORY_STOCK_STATUSES } from "../inventoryConstants.js";
import { formatInventoryCost, parseInventoryCost, receiptCost } from "../inventoryCostMath.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5_000;
const HEADER = ["warehouseCode", "binCode", "skuCode", "lotNumber", "expiryDate", "stockStatus", "baseQuantity"];
const COSTED_HEADER = [...HEADER, "unitCostHkd"];

function rejected(row, field, code) {
  return { rows: [], skippedRows: [], errors: [{ row, field, code }] };
}

export function parseInventoryOpeningCsv(bytes, { costingEnabled = false } = {}) {
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
  const fields = costingEnabled ? COSTED_HEADER : HEADER;
  if (header?.length !== fields.length || !fields.every((field, index) => header[index] === field)) {
    return rejected(1, "header", "OPENING_CSV_INVALID_HEADER");
  }
  if (data.length > MAX_ROWS) return rejected(MAX_ROWS + 2, "file", "OPENING_CSV_TOO_MANY_ROWS");

  const rows = [];
  const skippedRows = [];
  const errors = [];
  for (const [index, record] of data.entries()) {
    const row = index + 2;
    if (record.length !== fields.length) {
      errors.push({ row, field: "row", code: "OPENING_CSV_COLUMN_COUNT" });
      continue;
    }

    const [warehouseCode, binCode, skuCode, lotNumber, expiryDate, stockStatus, quantity, cost] =
      record.map(cell => cell.trim());
    const baseQuantity = Number(quantity);
    const priorErrorCount = errors.length;

    for (const [column, cell] of record.slice(0, 6).entries()) {
      const value = cell.trim();
      if (/\p{Cc}/u.test(cell) || /^[=+\-@]/u.test(value) || (column < 3 && !value) ||
          (HEADER[column] === "stockStatus" && !INVENTORY_STOCK_STATUSES.includes(value))) {
        errors.push({ row, field: HEADER[column], code: "OPENING_CSV_INVALID_FIELD" });
      }
    }
    if (!/^\d+$/u.test(quantity) || !Number.isSafeInteger(baseQuantity) || /\p{Cc}/u.test(record[6])) {
      errors.push({ row, field: "baseQuantity", code: "OPENING_CSV_INVALID_QUANTITY" });
    }
    let unitCostHkd;
    if (costingEnabled && (baseQuantity !== 0 || cost)) {
      try {
        if (/\p{Cc}/u.test(record[7]) || cost.startsWith("-")) throw new RangeError("Invalid unit cost");
        const unitCost = parseInventoryCost(cost);
        unitCostHkd = formatInventoryCost(unitCost);
        if (Number.isSafeInteger(baseQuantity) && baseQuantity > 0) receiptCost(BigInt(baseQuantity), unitCost, 1n);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        errors.push({ row, field: "unitCostHkd", code: "OPENING_CSV_INVALID_FIELD" });
      }
    }
    if (errors.length !== priorErrorCount) continue;
    if (baseQuantity === 0) skippedRows.push(row);
    else rows.push({ row, warehouseCode, binCode, skuCode, lotNumber, expiryDate, stockStatus, baseQuantity,
      ...(costingEnabled ? { unitCostHkd } : {}) });
  }
  return { rows: errors.length ? [] : rows, skippedRows, errors };
}
