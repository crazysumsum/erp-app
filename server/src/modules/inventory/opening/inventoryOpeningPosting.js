import { randomUUID } from "node:crypto";
import { inventoryError } from "../inventoryErrors.js";
import { openingPositionOccupied } from "./inventoryOpeningPrecheck.js";

const key = (...values) => JSON.stringify(values);
const priority = (a, b) => a < b ? -1 : a === b ? 0 : 1;

export async function applyInventoryOpeningRows(tx, rows, { jobId, claim, actor, reason, day, now, guard, locks, lookup }) {
  const locked = await locks.lockForCommand(tx, {
    warehouseIds: rows.map(row => row.warehouseId), binIds: rows.map(row => row.binId),
    stockControls: rows.map(({ warehouseId, skuId }) => ({ warehouseId, skuId })),
    lots: rows.filter(row => row.normalizedLotNumber !== null)
      .map(({ skuId, normalizedLotNumber }) => ({ skuId, normalizedLotNumber })),
    now
  });
  if (locked.binLocks.length) throw inventoryError("BIN_LOCKED_BY_STOCKTAKE");
  const warehouses = new Map(locked.warehouses.map(value => [Number(value.id), value]));
  const bins = new Map(locked.bins.map(value => [Number(value.id), value]));
  const lots = new Map(locked.lots.map(value => [key(Number(value.sku_id), value.normalized_lot_number), value]));
  const profiles = new Map();
  const positions = new Map();
  const conflicts = [];
  for (const row of rows) {
    guard.assertTime();
    const warehouse = warehouses.get(row.warehouseId), bin = bins.get(row.binId);
    if (warehouse?.status !== "ACTIVE" || Number(warehouse.version) !== row.warehouseVersion ||
        bin?.status !== "ACTIVE" || Number(bin.warehouse_id) !== row.warehouseId || Number(bin.version) !== row.binVersion) {
      throw inventoryError("OPENING_PRECHECK_STALE", { row: row.row });
    }
    if (!profiles.has(row.skuId)) {
      profiles.set(row.skuId, await lookup.getInventoryProfileInTransaction(tx, row.skuId));
    }
    const profile = profiles.get(row.skuId);
    if (!profile?.usable || !profile.inventoryTracked || profile.skuCode !== row.skuCode ||
        profile.trackingPolicy !== row.trackingPolicy ||
        profile.baseUom.uomId !== row.baseUomId) {
      throw inventoryError("OPENING_PRECHECK_STALE", { row: row.row });
    }
    const existingLot = lots.get(key(row.skuId, row.normalizedLotNumber));
    if ((existingLot ? Number(existingLot.id) : null) !== row.lotId) {
      throw inventoryError("OPENING_PRECHECK_STALE", { row: row.row });
    }
    if (row.normalizedLotNumber === null || existingLot) {
      const position = key(row.warehouseId, row.binId, row.skuId, row.lotId);
      if (!positions.has(position)) positions.set(position, await openingPositionOccupied(tx, row));
      if (positions.get(position)) conflicts.push(row.row);
    }
  }
  if (conflicts.length) throw inventoryError("OPENING_POSITION_OCCUPIED", { rows: conflicts });
  await guard.check(tx);

  const definedLots = new Map();
  for (const row of rows) {
    if (row.normalizedLotNumber !== null) definedLots.set(key(row.skuId, row.normalizedLotNumber), row);
  }
  for (const row of [...definedLots.values()].sort((a, b) => a.skuId - b.skuId ||
    priority(a.normalizedLotNumber, b.normalizedLotNumber))) {
    guard.assertTime();
    const lotKey = key(row.skuId, row.normalizedLotNumber);
    const existingLot = lots.get(lotKey);
    if (existingLot) {
      const [[fact]] = await tx.query("SELECT DATE_FORMAT(expiry_date, '%Y-%m-%d') expiry FROM inventory_lots WHERE id=?",
        [existingLot.id]);
      if (!fact || fact.expiry !== row.expiryDate) throw inventoryError("OPENING_PRECHECK_STALE", { row: row.row });
      continue;
    }
    const [created] = await tx.execute(
      `INSERT INTO inventory_lots
       (sku_id, lot_number, normalized_lot_number, expiry_date, first_receipt_date, sku_code_snapshot, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?)`, [row.skuId, row.lotNumber, row.normalizedLotNumber, row.expiryDate,
        day, profiles.get(row.skuId).skuCode, now, actor.id]
    );
    if (created.affectedRows !== 1) throw inventoryError("CONCURRENT_OPERATION");
    lots.set(lotKey, { id: created.insertId, lot_number: row.lotNumber });
  }

  const legs = rows.map(row => {
    const lot = lots.get(key(row.skuId, row.normalizedLotNumber));
    return { ...row, lotId: lot ? Number(lot.id) : null, lotNumber: lot?.lot_number ?? "" };
  });
  const balances = await locks.lockBalancesAfterLot(tx, {
    balances: legs.map(({ warehouseId, binId, skuId, lotId, stockStatus }) => ({ warehouseId, binId, skuId, lotId, stockStatus })), now
  });
  const byBucket = new Map(balances.map(row => [key(Number(row.warehouse_id), Number(row.bin_id),
    Number(row.sku_id), row.lot_id === null ? null : Number(row.lot_id), row.stock_status), row]));
  const groupId = randomUUID();
  for (const row of legs) {
    guard.assertTime();
    const balance = byBucket.get(key(row.warehouseId, row.binId, row.skuId, row.lotId, row.stockStatus));
    if (!balance || Number(balance.on_hand_quantity) !== 0 || Number(balance.allocated_quantity) !== 0) {
      throw inventoryError("OPENING_POSITION_OCCUPIED", { rows: [row.row] });
    }
    const profile = profiles.get(row.skuId), warehouse = warehouses.get(row.warehouseId), bin = bins.get(row.binId);
    const [updated] = await tx.execute(
      `UPDATE inventory_stock_balances SET fifo_anchor_date=?, on_hand_quantity=?, version=version+1, updated_at=?
       WHERE id=? AND version=? AND on_hand_quantity=0 AND allocated_quantity=0`,
      [day, row.baseQuantity, now, balance.id, balance.version]
    );
    if (updated.affectedRows !== 1) throw inventoryError("CONCURRENT_OPERATION");
    const [movement] = await tx.execute(
      `INSERT INTO inventory_movements (movement_group_id, operation_request_id, movement_type, location_kind,
       warehouse_id, bin_id, sku_id, lot_id, stock_status, direction, quantity, balance_before, balance_after,
       balance_version_after, reason_text, sku_code_snapshot, sku_name_snapshot, warehouse_code_snapshot, bin_code_snapshot,
       lot_number_snapshot, expiry_date_snapshot, posted_at, posted_by, posted_by_label)
       VALUES (?,?,'OPENING','BIN',?,?,?,?,?,'IN',?,0,?,?,
               ?,?,?,?,?,?,?,?,?,?)`,
      [groupId, claim.operationId, row.warehouseId, row.binId, row.skuId, row.lotId, row.stockStatus, row.baseQuantity,
        row.baseQuantity, Number(balance.version) + 1, reason, profile.skuCode, profile.skuName,
        warehouse.warehouse_code, bin.bin_code, row.lotNumber, row.expiryDate, now, actor.id, actor.username]
    );
    const [linked] = await tx.execute(
      "UPDATE inventory_opening_rows SET movement_id=? WHERE job_id=? AND csv_row_number=? AND movement_id IS NULL",
      [movement.insertId, jobId, row.row]
    );
    if (linked.affectedRows !== 1) throw inventoryError("CONCURRENT_OPERATION");
  }
  return groupId;
}
