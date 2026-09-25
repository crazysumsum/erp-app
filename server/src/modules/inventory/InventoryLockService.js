import { INVENTORY_STOCK_STATUSES } from "./inventoryConstants.js";
import { inventoryError } from "./inventoryErrors.js";
import { inventoryStringHasInvalidCharacters } from "./inventorySafeJson.js";
import { assertInventoryTransaction } from "./inventoryValidation.js";

const STOCK_STATUSES = new Set(INVENTORY_STOCK_STATUSES);
const RETRYABLE_LOCK_ERRORS = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

function id(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Invalid Inventory ${label}`);
  return value;
}

function ids(values = [], label) {
  if (!Array.isArray(values)) throw new TypeError(`Inventory ${label} must be an array`);
  return [...new Set(values.map((value) => id(value, label)))].sort((left, right) => left - right);
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > 100 ||
      inventoryStringHasInvalidCharacters(value)) {
    throw new TypeError(`Invalid Inventory ${label}`);
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function records(values = [], normalize, compare, key, label) {
  if (!Array.isArray(values)) throw new TypeError(`Inventory ${label} must be an array`);
  const unique = new Map();
  for (const value of values) {
    const normalized = normalize(value);
    unique.set(key(normalized), normalized);
  }
  return [...unique.values()].sort(compare);
}

function pairCompare(left, right) {
  return left.warehouseId - right.warehouseId || left.skuId - right.skuId;
}

function controlRows(values) {
  return records(
    values,
    (value) => ({
      warehouseId: id(value?.warehouseId, "stock control warehouse id"),
      skuId: id(value?.skuId, "stock control SKU id")
    }),
    pairCompare,
    (value) => `${value.warehouseId}:${value.skuId}`,
    "stock controls"
  );
}

function lotRows(values) {
  return records(
    values,
    (value) => ({
      skuId: id(value?.skuId, "lot SKU id"),
      normalizedLotNumber: text(value?.normalizedLotNumber, "normalized lot number")
    }),
    (left, right) => left.skuId - right.skuId ||
      compareText(left.normalizedLotNumber, right.normalizedLotNumber),
    (value) => `${value.skuId}:${value.normalizedLotNumber}`,
    "lots"
  );
}

function balanceRows(values) {
  return records(
    values,
    (value) => {
      const lotId = value?.lotId === null ? null : id(value?.lotId, "balance lot id");
      if (!STOCK_STATUSES.has(value?.stockStatus)) throw new TypeError("Invalid Inventory balance stock status");
      return {
        warehouseId: id(value?.warehouseId, "balance warehouse id"),
        skuId: id(value?.skuId, "balance SKU id"),
        binId: id(value?.binId, "balance bin id"),
        lotId,
        lotScope: lotId ?? 0,
        stockStatus: value.stockStatus
      };
    },
    (left, right) => left.warehouseId - right.warehouseId || left.skuId - right.skuId ||
      left.binId - right.binId || left.lotScope - right.lotScope ||
      compareText(left.stockStatus, right.stockStatus),
    (value) => `${value.warehouseId}:${value.skuId}:${value.binId}:${value.lotScope}:${value.stockStatus}`,
    "balances"
  );
}

function now(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid Inventory lock timestamp");
  return value;
}

function assertScope(warehouseIds, controls, binIds, balances) {
  const warehouses = new Set(warehouseIds);
  const controlKeys = new Set(controls.map((value) => `${value.warehouseId}:${value.skuId}`));
  const bins = new Set(binIds);
  for (const value of controls) {
    if (!warehouses.has(value.warehouseId)) {
      throw new TypeError("Inventory stock control requires its warehouse lock");
    }
  }
  for (const value of balances) {
    if (!warehouses.has(value.warehouseId) || !bins.has(value.binId) ||
        !controlKeys.has(`${value.warehouseId}:${value.skuId}`)) {
      throw new TypeError("Inventory balance requires its warehouse, stock control and bin locks");
    }
  }
}

async function lockIds(connection, table, values) {
  if (values.length === 0) return [];
  const [rows] = await connection.query(
    `SELECT * FROM ${table} WHERE id IN (${values.map(() => "?").join(", ")}) ORDER BY id FOR UPDATE`,
    values
  );
  return rows;
}

export class InventoryLockService {
  async lockForCommand(connection, input = {}) {
    assertInventoryTransaction(connection);
    try {
      const warehouseIds = ids(input.warehouseIds, "warehouse ids");
      const controls = controlRows(input.stockControls);
      const binIds = ids(input.binIds, "bin ids");
      const lots = lotRows(input.lots);
      const balances = balanceRows(input.balances);
      const reservationIds = ids(input.reservationIds, "reservation ids");
      const transferIds = ids(input.transferIds, "transfer ids");
      const stocktakeIds = ids(input.stocktakeIds, "stocktake ids");
      assertScope(warehouseIds, controls, binIds, balances);
      const timestamp = controls.length || balances.length ? now(input.now) : null;
      const locked = {};

      locked.warehouses = await lockIds(connection, "inventory_warehouses", warehouseIds);

      if (controls.length) {
        await connection.execute(
          `INSERT INTO inventory_stock_controls
             (warehouse_id, sku_id, reserved_quantity, version, created_at, updated_at)
           VALUES ${controls.map(() => "(?, ?, 0, 1, ?, ?)").join(", ")}
           ON DUPLICATE KEY UPDATE id = id`,
          controls.flatMap((value) => [value.warehouseId, value.skuId, timestamp, timestamp])
        );
        [locked.stockControls] = await connection.query(
          `SELECT * FROM inventory_stock_controls
           WHERE ${controls.map(() => "(warehouse_id = ? AND sku_id = ?)").join(" OR ")}
           ORDER BY warehouse_id, sku_id FOR UPDATE`,
          controls.flatMap((value) => [value.warehouseId, value.skuId])
        );
      } else locked.stockControls = [];

      locked.bins = await lockIds(connection, "inventory_bins", binIds);
      if (binIds.length) {
        [locked.binLocks] = await connection.query(
          `SELECT * FROM inventory_bin_locks
           WHERE bin_id IN (${binIds.map(() => "?").join(", ")}) AND released_at IS NULL
           ORDER BY bin_id, id FOR UPDATE`,
          binIds
        );
      } else locked.binLocks = [];

      if (lots.length) {
        [locked.lots] = await connection.query(
          `SELECT * FROM inventory_lots
           WHERE ${lots.map(() => "(sku_id = ? AND normalized_lot_number = ?)").join(" OR ")}
           ORDER BY sku_id, normalized_lot_number FOR UPDATE`,
          lots.flatMap((value) => [value.skuId, value.normalizedLotNumber])
        );
      } else locked.lots = [];

      if (balances.length) {
        await connection.execute(
          `INSERT INTO inventory_stock_balances
             (warehouse_id, bin_id, sku_id, lot_id, stock_status, on_hand_quantity,
              allocated_quantity, fifo_anchor_date, version, created_at, updated_at)
           VALUES ${balances.map(() => "(?, ?, ?, ?, ?, 0, 0, NULL, 1, ?, ?)").join(", ")}
           ON DUPLICATE KEY UPDATE id = id`,
          balances.flatMap((value) => [
            value.warehouseId, value.binId, value.skuId, value.lotId, value.stockStatus,
            timestamp, timestamp
          ])
        );
        [locked.balances] = await connection.query(
          `SELECT * FROM inventory_stock_balances
           WHERE ${balances.map(() => (
             "(warehouse_id = ? AND sku_id = ? AND bin_id = ? AND lot_scope = ? AND stock_status = ?)"
           )).join(" OR ")}
           ORDER BY warehouse_id, sku_id, bin_id, lot_scope, stock_status FOR UPDATE`,
          balances.flatMap((value) => [
            value.warehouseId, value.skuId, value.binId, value.lotScope, value.stockStatus
          ])
        );
      } else locked.balances = [];

      locked.reservations = await lockIds(connection, "inventory_reservations", reservationIds);
      locked.transfers = await lockIds(connection, "inventory_transfers", transferIds);
      locked.stocktakes = await lockIds(connection, "inventory_stocktakes", stocktakeIds);
      return locked;
    } catch (error) {
      if (RETRYABLE_LOCK_ERRORS.has(error?.cause?.code ?? error?.code)) {
        throw inventoryError("CONCURRENT_OPERATION");
      }
      throw error;
    }
  }
}
