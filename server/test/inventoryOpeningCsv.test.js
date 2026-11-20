import assert from "node:assert/strict";
import test from "node:test";
import { parseInventoryOpeningCsv } from "../src/modules/inventory/opening/inventoryOpeningCsv.js";

const header = "warehouseCode,binCode,skuCode,lotNumber,expiryDate,stockStatus,baseQuantity";
const valid = "W1,B1,SKU1,,,AVAILABLE,12";

function parse(...records) {
  return parseInventoryOpeningCsv(Buffer.from(records.join("\r\n")));
}

test("Opening CSV preserves batch fields and reports zero rows separately", () => {
  const result = parse("\uFEFF" + header, valid, 'W2,B2,SKU2,"LOT, A",2027-06-30,AVAILABLE,7',
    "W2,B3,SKU3,,,AVAILABLE,0");

  assert.deepEqual(result, {
    rows: [
      { row: 2, warehouseCode: "W1", binCode: "B1", skuCode: "SKU1", lotNumber: "", expiryDate: "", stockStatus: "AVAILABLE", baseQuantity: 12 },
      { row: 3, warehouseCode: "W2", binCode: "B2", skuCode: "SKU2", lotNumber: "LOT, A", expiryDate: "2027-06-30", stockStatus: "AVAILABLE", baseQuantity: 7 }
    ],
    skippedRows: [4],
    errors: []
  });
});

test("Opening CSV reports safe row and field errors and withholds all posting rows", () => {
  const result = parse(header, valid, "W1,B1,=1+1,,,AVAILABLE,1.5",
    "W1,B1,SKU2,,,UNKNOWN,9007199254740992", "W1,B1,SKU3");

  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, [
    { row: 3, field: "skuCode", code: "OPENING_CSV_INVALID_FIELD" },
    { row: 3, field: "baseQuantity", code: "OPENING_CSV_INVALID_QUANTITY" },
    { row: 4, field: "stockStatus", code: "OPENING_CSV_INVALID_FIELD" },
    { row: 4, field: "baseQuantity", code: "OPENING_CSV_INVALID_QUANTITY" },
    { row: 5, field: "row", code: "OPENING_CSV_COLUMN_COUNT" }
  ]);
});

test("Opening CSV rejects missing or changed headers, invalid UTF-8 and malformed quoting", () => {
  for (const input of ["", header.replace("binCode", "warehouseCode")]) {
    assert.deepEqual(parse(input).errors, [{ row: 1, field: "header", code: "OPENING_CSV_INVALID_HEADER" }]);
  }
  assert.deepEqual(parseInventoryOpeningCsv(Buffer.from([0xff])).errors,
    [{ row: 1, field: "file", code: "OPENING_CSV_INVALID_UTF8" }]);
  assert.deepEqual(parse(header, '"unterminated').errors,
    [{ row: 2, field: "row", code: "OPENING_CSV_MALFORMED" }]);
});

test("Opening CSV counts zero rows towards the 5000 data row limit", () => {
  const zero = "W1,B1,SKU1,,,AVAILABLE,0";
  const atLimit = parse(header, ...Array(5000).fill(zero));
  assert.equal(atLimit.skippedRows.length, 5000);
  assert.deepEqual(atLimit.errors, []);

  const aboveLimit = parse(header, ...Array(5001).fill(zero));
  assert.deepEqual(aboveLimit.rows, []);
  assert.deepEqual(aboveLimit.errors, [{ row: 5002, field: "file", code: "OPENING_CSV_TOO_MANY_ROWS" }]);
});
