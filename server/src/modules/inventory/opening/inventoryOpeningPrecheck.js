import { normalizeAndValidateSkuCode } from "../../item/itemValidation.js";
import { inventoryError } from "../inventoryErrors.js";
import { validateInventoryLotInput } from "../inventoryValidation.js";
import { parseInventoryOpeningCsv } from "./inventoryOpeningCsv.js";

function masterCode(code) {
  return code.normalize("NFKC").toUpperCase();
}

function cached(cache, key, load) {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key);
}

function collect(groups, key, row) {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

async function findLocation(reader, warehouseCode, binCode) {
  const [[location]] = await reader.query(
    `SELECT w.id warehouse_id, w.version warehouse_version, b.id bin_id, b.version bin_version
       FROM inventory_bins b
       JOIN inventory_warehouses w ON w.id = b.warehouse_id
      WHERE w.normalized_code = ? AND b.normalized_code = ?
        AND w.status = 'ACTIVE' AND b.status = 'ACTIVE'`,
    [warehouseCode, binCode]
  );
  return location;
}

async function findLot(reader, skuId, lotNumber) {
  const [[lot]] = await reader.query(
    `SELECT id, DATE_FORMAT(expiry_date, '%Y-%m-%d') expiry_date
       FROM inventory_lots WHERE sku_id = ? AND normalized_lot_number = ?`,
    [skuId, lotNumber]
  );
  return lot;
}

export async function openingPositionOccupied(reader, { warehouseId, binId, skuId, lotId }) {
  const position = [warehouseId, binId, skuId, lotId];
  const [[fact]] = await reader.query(
    `SELECT EXISTS (
       SELECT 1 FROM inventory_stock_balances
        WHERE warehouse_id = ? AND bin_id = ? AND sku_id = ? AND lot_id <=> ? AND on_hand_quantity > 0
     ) OR EXISTS (
       SELECT 1 FROM inventory_movements
        WHERE warehouse_id = ? AND bin_id = ? AND sku_id = ? AND lot_id <=> ?
     ) AS occupied`,
    [...position, ...position]
  );
  if (!fact || ![0, 1].includes(Number(fact.occupied)) || fact.occupied === null) {
    throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  }
  return Number(fact.occupied) === 1;
}

const lotErrorFields = {
  LOT_REQUIRED: "lotNumber",
  EXPIRY_REQUIRED: "expiryDate",
  SERIAL_TRACKING_UNSUPPORTED: "skuCode"
};

function lotIssue(error, row) {
  const field = Object.hasOwn(lotErrorFields, error.code) ? lotErrorFields[error.code]
    : error.code === "INVENTORY_INPUT_INVALID"
      ? (error.details?.field === "lot" ? (row.lotNumber ? "lotNumber" : "expiryDate") : error.details?.field)
      : null;
  if (!field) throw error;
  return { row: row.row, field, code: error.code };
}

// This is an advisory read. Confirm must revalidate current facts under the writer's locks.
export async function precheckInventoryOpeningCsv(bytes, { reader, itemLookup }) {
  const result = parseInventoryOpeningCsv(bytes);
  if (result.errors.length) return result;

  const locations = new Map(), skus = new Map(), lots = new Map(), positions = new Map();
  const buckets = new Map(), lotRows = new Map();
  const rows = [], errors = [];
  for (const row of result.rows) {
    const warehouseCode = masterCode(row.warehouseCode), binCode = masterCode(row.binCode);
    const location = await cached(locations, JSON.stringify([warehouseCode, binCode]),
      () => findLocation(reader, warehouseCode, binCode));
    if (!location) errors.push({ row: row.row, field: "binCode", code: "BIN_WAREHOUSE_MISMATCH" });
    let skuCode;
    try {
      skuCode = normalizeAndValidateSkuCode(row.skuCode);
    } catch (error) {
      if (error.code !== "SKU_CODE_INVALID") throw error;
      errors.push({ row: row.row, field: "skuCode", code: error.code });
      continue;
    }
    const sku = await cached(skus, skuCode, () => itemLookup.findByCode(skuCode, { purpose: "inventory" }));
    const baseUom = sku?.uoms.find(uom => uom.isBase && uom.toBaseFactor === 1);
    if (!sku?.usable || !sku.inventoryTracked || !baseUom) {
      errors.push({ row: row.row, field: "skuCode", code: "OPENING_SKU_UNAVAILABLE" });
      continue;
    }

    let lotInput;
    try {
      lotInput = validateInventoryLotInput({
        trackingPolicy: sku.trackingPolicy, lotNumber: row.lotNumber, expiryDate: row.expiryDate
      });
    } catch (error) {
      errors.push(lotIssue(error, row));
      continue;
    }
    if (!location) continue;

    const lotKey = JSON.stringify([sku.skuId, lotInput.normalizedLotNumber]);
    const existingLot = lotInput.normalizedLotNumber === null ? null :
      await cached(lots, lotKey, () => findLot(reader, sku.skuId, lotInput.normalizedLotNumber));
    const resolved = {
      ...row, ...lotInput, skuId: sku.skuId, baseUomId: baseUom.uomId,
      warehouseId: Number(location.warehouse_id), warehouseVersion: Number(location.warehouse_version),
      binId: Number(location.bin_id), binVersion: Number(location.bin_version),
      lotId: existingLot ? Number(existingLot.id) : null
    };

    const position = [resolved.warehouseId, resolved.binId, resolved.skuId, resolved.normalizedLotNumber];
    collect(buckets, JSON.stringify([...position, resolved.stockStatus]), resolved);
    if (resolved.normalizedLotNumber !== null) collect(lotRows, lotKey, resolved);
    if (resolved.normalizedLotNumber === null || existingLot) {
      if (await cached(positions, JSON.stringify(position), () => openingPositionOccupied(reader, resolved))) {
        errors.push({ row: row.row, field: "row", code: "OPENING_POSITION_OCCUPIED" });
      }
    }
    rows.push(resolved);
  }

  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    for (const row of group) errors.push({ row: row.row, field: "row", code: "OPENING_DUPLICATE_BUCKET" });
  }
  for (const [key, group] of lotRows) {
    const existingLot = await lots.get(key);
    const conflictingDates = new Set(group.map(row => row.expiryDate)).size > 1;
    for (const row of group) {
      if (conflictingDates || (existingLot && existingLot.expiry_date !== row.expiryDate)) {
        errors.push({ row: row.row, field: "expiryDate", code: "LOT_DATA_CONFLICT" });
      }
    }
  }
  errors.sort((left, right) => left.row - right.row);
  return { rows: errors.length ? [] : rows, skippedRows: result.skippedRows, errors };
}
