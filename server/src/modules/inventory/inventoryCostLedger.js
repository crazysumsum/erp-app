import { formatInventoryCost, parseInventoryCost } from "./inventoryCostMath.js";
import { inventoryError } from "./inventoryErrors.js";

const TABLES = ["inventory_cost_entries", "inventory_cost_pools"];
const MIGRATION = "migrations/0130_create_inventory_cost.js";
const MAX_ID = 2n ** 64n - 1n;
const READ_BATCH_SIZE = 500;
const WRITE_BATCH_SIZE = 100;
const MAX_VERSION = 4294967295;
const CORRECTIONS = {
  RECEIPT: ["RECEIPT_REVERSAL", "SUPPLIER_RETURN"],
  ISSUE: ["ISSUE_REVERSAL", "CUSTOMER_RETURN"],
  ADJUSTMENT_IN: ["ADJUSTMENT_IN_REVERSAL"],
  ADJUSTMENT_OUT: ["ADJUSTMENT_OUT_REVERSAL"]
};

function unavailable() { return inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE"); }

export async function readInventoryCostInstallation(tx) {
  const [tables] = await tx.query(
    `SELECT table_name AS table_name, engine AS engine FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN (?,?) ORDER BY table_name`, TABLES);
  const [[migration]] = await tx.query(
    "SELECT EXISTS(SELECT 1 FROM fr_schema_migrations WHERE name = ?) AS installed", [MIGRATION]);
  if (!tables.length && Number(migration?.installed) === 0) return false;
  if (Number(migration?.installed) !== 1 || tables.length !== TABLES.length ||
      TABLES.some((name, index) => tables[index].table_name !== name || tables[index].engine !== "InnoDB")) throw unavailable();
  return true;
}

function compareIds(a, b) { return a.length - b.length || (a < b ? -1 : Number(a !== b)); }

function sortedMovementIds(input) {
  const ids = input?.movementIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5000 ||
      ids.some(id => typeof id !== "string" || !/^[1-9][0-9]{0,19}$/u.test(id) || BigInt(id) > MAX_ID) ||
      new Set(ids).size !== ids.length) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "movementIds" });
  }
  return ids.toSorted(compareIds);
}

function validIssueCost(row) {
  if (row.entry_kind !== "ISSUE" || row.cost_sku_id !== row.movement_sku_id ||
      row.quantity_delta !== `-${row.movement_quantity}`) return false;
  try { return parseInventoryCost(row.value_delta_hkd) <= 0n; }
  catch { return false; }
}

// The caller holds the shipment lock. The Movement and cost rows are immutable,
// so a complete current READ COMMITTED lookup needs no additional row locks.
export async function readIssueCostAvailability(tx, input) {
  const ids = sortedMovementIds(input);
  if (!await readInventoryCostInstallation(tx)) throw unavailable();
  let missing = false;
  for (let offset = 0; offset < ids.length; offset += READ_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + READ_BATCH_SIZE);
    const [rows] = await tx.query(`
      SELECT CAST(m.id AS CHAR) AS movement_id, CAST(m.sku_id AS CHAR) AS movement_sku_id,
             m.movement_type, m.direction AS movement_direction, CAST(m.quantity AS CHAR) AS movement_quantity,
             CAST(e.id AS CHAR) AS entry_id, CAST(e.sku_id AS CHAR) AS cost_sku_id, e.entry_kind,
             CAST(e.quantity_delta AS CHAR) AS quantity_delta, e.value_delta_hkd
        FROM inventory_movements m
        LEFT JOIN inventory_cost_entries e ON e.movement_id=m.id
       WHERE m.id IN (${batch.map(() => "?").join(",")})
       ORDER BY m.id`, batch);
    if (rows.length !== batch.length) throw unavailable();
    for (const [index, row] of rows.entries()) {
      if (row.movement_id !== batch[index] || row.movement_type !== "ISSUE" || row.movement_direction !== "OUT" ||
          !/^[1-9]\d*$/u.test(row.movement_quantity)) throw unavailable();
      if (row.entry_id === null) missing = true;
      else if (!validIssueCost(row)) throw unavailable();
    }
  }
  return { state: missing ? "MISSING" : "AVAILABLE", costingEnabled: true };
}

// Callers hold the original Movement and its business source locks. Use current
// reads under RR so a competing return committed before those locks is visible.
export async function lockOriginalInventoryCosts(tx, originals) {
  const byMovement = new Map(originals.map(row => [String(row.id), row]));
  const byEntry = new Map(), result = new Map();
  const movementIds = [...byMovement.keys()].sort(compareIds);
  for (let offset = 0; offset < movementIds.length; offset += READ_BATCH_SIZE) {
    const batch = movementIds.slice(offset, offset + READ_BATCH_SIZE);
    const [rows] = await tx.query(`SELECT CAST(id AS CHAR) AS id, CAST(movement_id AS CHAR) AS movement_id,
      CAST(sku_id AS CHAR) AS sku_id, entry_kind, CAST(quantity_delta AS CHAR) AS quantity_delta, value_delta_hkd
      FROM inventory_cost_entries WHERE movement_id IN (${batch.map(() => "?").join(",")})
      ORDER BY movement_id FOR SHARE`, batch);
    if (rows.length !== batch.length) throw inventoryError("INVENTORY_COST_SOURCE_MISSING");
    for (const [index, row] of rows.entries()) {
      const original = byMovement.get(batch[index]), direction = original.direction === "IN" ? 1n : -1n;
      const quantity = BigInt(original.quantity), value = parseInventoryCost(row.value_delta_hkd) * direction;
      if (!Object.hasOwn(CORRECTIONS, original.kind) || row.movement_id !== batch[index] ||
          row.sku_id !== String(original.sku_id) || row.entry_kind !== original.kind ||
          row.quantity_delta !== String(quantity * direction) || value < 0n) throw unavailable();
      const basis = { id: row.id, skuId: row.sku_id, quantity, value, used: 0n };
      byEntry.set(row.id, { basis, direction, allowed: CORRECTIONS[original.kind] });
      result.set(row.movement_id, basis);
    }
  }
  const entryIds = [...byEntry.keys()].sort(compareIds);
  for (let offset = 0; offset < entryIds.length; offset += READ_BATCH_SIZE) {
    const batch = entryIds.slice(offset, offset + READ_BATCH_SIZE);
    const [rows] = await tx.query(`SELECT CAST(original_entry_id AS CHAR) AS original_entry_id,
      CAST(sku_id AS CHAR) AS sku_id, entry_kind, CAST(quantity_delta AS CHAR) AS quantity_delta
      FROM inventory_cost_entries WHERE original_entry_id IN (${batch.map(() => "?").join(",")})
      ORDER BY original_entry_id, id FOR SHARE`, batch);
    for (const row of rows) {
      const parent = byEntry.get(row.original_entry_id);
      if (!parent || row.sku_id !== parent.basis.skuId || !parent.allowed.includes(row.entry_kind)) throw unavailable();
      const used = BigInt(row.quantity_delta) * -parent.direction;
      if (used <= 0n || parent.basis.used + used > parent.basis.quantity) throw unavailable();
      parent.basis.used += used;
    }
  }
  return result;
}

export async function lockInventoryCostPools(tx, skuIds, at) {
  const ids = [...new Set(skuIds.map(String))].sort(compareIds);
  const pools = new Map();
  for (let offset = 0; offset < ids.length; offset += WRITE_BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + WRITE_BATCH_SIZE);
    await tx.execute(`
      INSERT INTO inventory_cost_pools (sku_id, updated_at)
      VALUES ${chunk.map(() => "(?,?)").join(",")}
      ON DUPLICATE KEY UPDATE sku_id=inventory_cost_pools.sku_id`,
    chunk.flatMap(skuId => [skuId, at]));
    const [rows] = await tx.query(`
      SELECT CAST(p.sku_id AS CHAR) AS sku_id, CAST(p.costed_quantity AS CHAR) AS costed_quantity,
             p.value_hkd, p.version
        FROM inventory_cost_pools p WHERE p.sku_id IN (${chunk.map(() => "?").join(",")})
       ORDER BY p.sku_id FOR UPDATE`, chunk);
    if (rows.length !== chunk.length) throw unavailable();
    for (const [index, row] of rows.entries()) {
      if (row.sku_id !== chunk[index] || !/^(0|[1-9]\d*)$/u.test(row.costed_quantity) ||
          !Number.isInteger(row.version) || row.version < 1 || row.version >= MAX_VERSION) throw unavailable();
      const quantity = BigInt(row.costed_quantity), value = parseInventoryCost(row.value_hkd);
      if (value < 0n || (quantity === 0n && value !== 0n)) throw unavailable();
      pools.set(row.sku_id, { quantity, value, version: row.version });
    }
  }
  return pools;
}

// Each movement has its own historical pool snapshot. Only the final balance
// for each SKU is written to the already-locked live cost pool.
export async function persistInventoryCostBatch(tx, locked, entries, at) {
  const final = new Map();
  for (const entry of entries) {
    const previous = final.get(entry.skuId) ?? locked.get(entry.skuId);
    if (!previous || previous.quantity + entry.quantityDelta !== entry.quantity ||
        previous.value + entry.valueDelta !== entry.value) throw unavailable();
    final.set(entry.skuId, entry);
  }
  for (let offset = 0; offset < entries.length; offset += WRITE_BATCH_SIZE) {
    const chunk = entries.slice(offset, offset + WRITE_BATCH_SIZE);
    const [result] = await tx.execute(`
      INSERT INTO inventory_cost_entries (movement_id, sku_id, entry_kind, quantity_delta, value_delta_hkd,
        original_entry_id, original_value_hkd, unit_cost_source, pool_quantity_after, pool_value_after_hkd, posted_at)
      VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
    chunk.flatMap(entry => [entry.movementId, entry.skuId, entry.kind, entry.quantityDelta.toString(),
      formatInventoryCost(entry.valueDelta), entry.originalEntryId ?? null,
      entry.originalValue == null ? null : formatInventoryCost(entry.originalValue),
      entry.source, entry.quantity.toString(), formatInventoryCost(entry.value), at]));
    if (result.affectedRows !== chunk.length) throw unavailable();
  }

  const skuIds = [...final.keys()].sort(compareIds);
  for (let offset = 0; offset < skuIds.length; offset += WRITE_BATCH_SIZE) {
    const chunk = skuIds.slice(offset, offset + WRITE_BATCH_SIZE);
    const source = "SELECT CAST(? AS UNSIGNED) AS sku_id, CAST(? AS UNSIGNED) AS quantity, CAST(? AS DECIMAL(19,4)) AS value_hkd, ? AS version";
    const [result] = await tx.execute(`
      UPDATE inventory_cost_pools p JOIN (${chunk.map(() => source).join(" UNION ALL ")}) target
        ON p.sku_id = target.sku_id AND p.version = target.version
       SET p.costed_quantity=target.quantity, p.value_hkd=target.value_hkd, p.version=p.version+1, p.updated_at=?`,
    [...chunk.flatMap(skuId => [skuId, final.get(skuId).quantity.toString(),
      formatInventoryCost(final.get(skuId).value), locked.get(skuId).version]), at]);
    if (result.affectedRows !== chunk.length) throw inventoryError("CONCURRENT_OPERATION");
  }
}
